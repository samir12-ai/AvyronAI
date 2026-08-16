import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColorScheme } from 'react-native';
import Colors from '@/constants/colors';

// ─── Typed shape of audience_snapshots (matches shared/schema.ts.audienceSnapshots)
interface AwarenessLevelStruct {
  level?: string;
  distribution?: Record<string, number>;
  evidenceCount?: number;
  sourceSignals?: string[];
  confidence?: number;
  [key: string]: any;
}
interface MaturityIndexStruct {
  level?: string;
  distribution?: Record<string, number>;
  evidenceCount?: number;
  confidence?: number;
  confidenceScore?: number;
  indicators?: string[];
  [key: string]: any;
}
interface PainItem {
  canonical?: string;
  pain?: string;
  name?: string;
  frequency?: number;
  confidence?: number;
  evidence?: string[];
  category?: string;
}
interface DesireItem {
  canonical?: string;
  desire?: string;
  name?: string;
  frequency?: number;
  confidence?: number;
  evidence?: string[];
}
interface ObjectionItem {
  canonical?: string;
  objection?: string;
  name?: string;
  frequency?: number;
  confidence?: number;
  category?: string;
  evidence?: string[];
}
interface EmotionalDriver {
  driver?: string;
  name?: string;
  frequency?: number;
  confidence?: number;
}
interface AudienceSegment {
  name?: string;
  description?: string;
  painProfile?: string[];
  desireProfile?: string[];
  objectionProfile?: string[];
  density?: number;
}
interface TransformationMapItem {
  before?: string;
  after?: string;
  axis?: string;
  frequency?: number;
}
interface PainCluster {
  id?: string;
  label?: string;
  frequency?: number;
  confidence?: number;
}

export interface AudienceEngineSnapshot {
  exists?: boolean;
  id?: string;
  status?: string;
  statusMessage?: string | null;
  engineVersion?: number;
  awarenessLevel?: AwarenessLevelStruct | null;
  maturityIndex?: MaturityIndexStruct | null;
  audiencePains?: PainItem[] | any;
  desireMap?: DesireItem[] | any;
  objectionMap?: ObjectionItem[] | any;
  emotionalDrivers?: EmotionalDriver[] | any;
  audienceSegments?: AudienceSegment[] | any;
  segmentDensity?: any;
  transformationMap?: TransformationMapItem[] | any;
  audienceIntentDistribution?: any;
  adsTargetingHints?: Record<string, any> | null;
  languageSignals?: any;
  signalLineage?: any;
  structuredSignals?: {
    pain_clusters?: PainCluster[];
    desire_clusters?: PainCluster[];
    objection_clusters?: PainCluster[];
  } | null;
  inputSummary?: any;
  executionTimeMs?: number;
  createdAt?: string;
  // permissive — many legacy fields (defensiveMode, painMap, intentDistribution, freshnessMetadata, etc.)
  // are surfaced by the existing audience UI; we don't want a typed-shape switch to break them.
  [key: string]: any;
}

interface Props {
  data: AudienceEngineSnapshot | null;
  loading?: boolean;
  error?: string;
}

// helpers
function safeArray<T = any>(v: any): T[] {
  if (Array.isArray(v)) return v as T[];
  if (v && typeof v === 'object') return Object.values(v) as T[];
  return [];
}
function pct(n: number | undefined | null): string {
  if (typeof n !== 'number' || isNaN(n)) return '—';
  return `${(n * 100).toFixed(0)}%`;
}
function maybeJSON(v: any): any {
  if (v == null) return null;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return v; }
}

// Distribution bar — used for awareness/maturity/intent distributions
function DistributionBar({ dist, isDark }: { dist: Record<string, number>; isDark: boolean }) {
  const entries = Object.entries(dist || {}).filter(([_, v]) => typeof v === 'number');
  const total = entries.reduce((s, [, v]) => s + v, 0) || 1;
  const colors = ['#EF4444', '#F59E0B', '#3B82F6', '#8B5CF6', '#10B981', '#06B6D4'];
  if (entries.length === 0) return null;
  return (
    <View style={{ marginTop: 8 }}>
      <View style={{ flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', backgroundColor: isDark ? '#1F2937' : '#F3F4F6' }}>
        {entries.map(([k, v], i) => (
          <View key={k} style={{ flex: v / total, backgroundColor: colors[i % colors.length] }} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
        {entries.map(([k, v], i) => (
          <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: colors[i % colors.length] }} />
            <Text style={{ fontSize: 10, color: isDark ? '#9CA3AF' : '#6B7280' }}>
              {k.replace(/_/g, ' ')} {pct(v / total)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// Generic item card with frequency + confidence + evidence
function SignalItem({
  label,
  frequency,
  confidence,
  evidence,
  category,
  isDark,
  accent,
}: {
  label: string;
  frequency?: number | null;
  confidence?: number | null;
  evidence?: string[];
  category?: string;
  isDark: boolean;
  accent: string;
}) {
  return (
    <View style={[styles.signalItem, isDark && styles.signalItemDark]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {category && (
          <View style={[styles.miniTag, { backgroundColor: accent + '20' }]}>
            <Text style={[styles.miniTagText, { color: accent }]}>{category}</Text>
          </View>
        )}
        {typeof frequency === 'number' && (
          <View style={[styles.miniTag, { backgroundColor: '#6366F115' }]}>
            <Text style={[styles.miniTagText, { color: '#6366F1' }]}>freq {frequency}</Text>
          </View>
        )}
        {typeof confidence === 'number' && (
          <View style={[styles.miniTag, { backgroundColor: '#10B98115' }]}>
            <Text style={[styles.miniTagText, { color: '#10B981' }]}>conf {pct(confidence)}</Text>
          </View>
        )}
      </View>
      <Text style={[styles.signalText, isDark && styles.textLight]}>{label}</Text>
      {evidence && evidence.length > 0 && (
        <View style={{ marginTop: 4, gap: 2 }}>
          {evidence.slice(0, 2).map((e, ei) => (
            <Text key={ei} style={[styles.evidenceText, isDark && { color: '#6B7280' }]} numberOfLines={2}>
              "{e}"
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

export default function AudienceEngine({ data, loading, error }: Props) {
  const colorScheme = useColorScheme();
  const isDark = true; // forced dark mode
  const colors = isDark ? Colors.dark : Colors.light;

  const normalized = useMemo(() => {
    if (!data) return null;
    return {
      ...data,
      awarenessLevel: maybeJSON(data.awarenessLevel),
      maturityIndex: maybeJSON(data.maturityIndex),
      audiencePains: safeArray<PainItem>(maybeJSON(data.audiencePains)),
      desireMap: safeArray<DesireItem>(maybeJSON(data.desireMap)),
      objectionMap: maybeJSON(data.objectionMap),
      emotionalDrivers: safeArray<EmotionalDriver>(maybeJSON(data.emotionalDrivers)),
      audienceSegments: safeArray<AudienceSegment>(maybeJSON(data.audienceSegments)),
      segmentDensity: maybeJSON(data.segmentDensity),
      transformationMap: safeArray<TransformationMapItem>(maybeJSON(data.transformationMap)),
      audienceIntentDistribution: maybeJSON(data.audienceIntentDistribution),
      adsTargetingHints: maybeJSON(data.adsTargetingHints),
      structuredSignals: maybeJSON(data.structuredSignals),
    };
  }, [data]);

  if (loading) {
    return (
      <View style={[styles.empty, { backgroundColor: colors.card }]}>
        <ActivityIndicator color={colors.accent} />
        <Text style={[styles.emptyText, { color: colors.textMuted }]}>Loading audience intelligence…</Text>
      </View>
    );
  }
  if (error) {
    return (
      <View style={[styles.empty, { backgroundColor: '#EF444415' }]}>
        <Ionicons name="alert-circle" size={20} color="#EF4444" />
        <Text style={[styles.emptyText, { color: '#EF4444' }]}>{error}</Text>
      </View>
    );
  }
  if (!normalized) {
    return (
      <View style={[styles.empty, { backgroundColor: colors.card }]}>
        <Ionicons name="people-outline" size={36} color={colors.textMuted} />
        <Text style={[styles.emptyText, { color: colors.textMuted }]}>No audience snapshot yet.</Text>
      </View>
    );
  }

  const aw = (normalized.awarenessLevel || {}) as AwarenessLevelStruct;
  const mat = (normalized.maturityIndex || {}) as MaturityIndexStruct;

  // objectionMap may be either an array of objects, or a dict keyed by canonical name
  const objections: ObjectionItem[] = (() => {
    const om = normalized.objectionMap as any;
    if (Array.isArray(om)) return om;
    if (om && typeof om === 'object') {
      return Object.entries(om).map(([k, v]: [string, any]) => ({
        canonical: (v && typeof v === 'object' && v.canonical) || k,
        frequency: (v && typeof v === 'object' && v.frequency) ?? null,
        confidence: (v && typeof v === 'object' && v.confidence) ?? null,
        evidence: (v && typeof v === 'object' && Array.isArray(v.evidence)) ? v.evidence : [],
        category: (v && typeof v === 'object' && v.category) || undefined,
      }));
    }
    return [];
  })();

  const painClusters = (normalized.structuredSignals as any)?.pain_clusters || [];

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      {/* Awareness Level */}
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
        <View style={styles.cardHeader}>
          <Ionicons name="bulb-outline" size={16} color="#8B5CF6" />
          <Text style={[styles.cardTitle, { color: colors.text }]}>Awareness Level</Text>
          {aw.level && (
            <View style={[styles.headerBadge, { backgroundColor: '#8B5CF615' }]}>
              <Text style={[styles.headerBadgeText, { color: '#8B5CF6' }]}>{String(aw.level).replace(/_/g, ' ')}</Text>
            </View>
          )}
        </View>
        {aw.distribution && <DistributionBar dist={aw.distribution} isDark={isDark} />}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
          {typeof aw.evidenceCount === 'number' && (
            <Text style={{ fontSize: 11, color: colors.textMuted }}>evidence: {aw.evidenceCount}</Text>
          )}
          {typeof aw.confidence === 'number' && (
            <Text style={{ fontSize: 11, color: colors.textMuted }}>confidence: {pct(aw.confidence)}</Text>
          )}
          {Array.isArray(aw.sourceSignals) && aw.sourceSignals.length > 0 && (
            <Text style={{ fontSize: 11, color: colors.textMuted }}>sources: {aw.sourceSignals.length}</Text>
          )}
        </View>
      </View>

      {/* Maturity Index */}
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
        <View style={styles.cardHeader}>
          <Ionicons name="trending-up" size={16} color="#06B6D4" />
          <Text style={[styles.cardTitle, { color: colors.text }]}>Maturity Index</Text>
          {mat.level && (
            <View style={[styles.headerBadge, { backgroundColor: '#06B6D415' }]}>
              <Text style={[styles.headerBadgeText, { color: '#06B6D4' }]}>{String(mat.level).replace(/_/g, ' ')}</Text>
            </View>
          )}
        </View>
        {mat.distribution && <DistributionBar dist={mat.distribution} isDark={isDark} />}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
          {typeof mat.evidenceCount === 'number' && (
            <Text style={{ fontSize: 11, color: colors.textMuted }}>evidence: {mat.evidenceCount}</Text>
          )}
          {typeof mat.confidence === 'number' && (
            <Text style={{ fontSize: 11, color: colors.textMuted }}>confidence: {pct(mat.confidence)}</Text>
          )}
        </View>
      </View>

      {/* Audience Intent Distribution */}
      {normalized.audienceIntentDistribution && Object.keys(normalized.audienceIntentDistribution).length > 0 && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <View style={styles.cardHeader}>
            <Ionicons name="compass-outline" size={16} color="#F59E0B" />
            <Text style={[styles.cardTitle, { color: colors.text }]}>Intent Distribution</Text>
          </View>
          <DistributionBar dist={normalized.audienceIntentDistribution as any} isDark={isDark} />
        </View>
      )}

      {/* Audience Pains */}
      {normalized.audiencePains.length > 0 && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <View style={styles.cardHeader}>
            <Ionicons name="warning-outline" size={16} color="#EF4444" />
            <Text style={[styles.cardTitle, { color: colors.text }]}>Audience Pains</Text>
            <View style={[styles.headerBadge, { backgroundColor: '#EF444415' }]}>
              <Text style={[styles.headerBadgeText, { color: '#EF4444' }]}>{normalized.audiencePains.length}</Text>
            </View>
          </View>
          {normalized.audiencePains.map((p: PainItem, i: number) => (
            <SignalItem
              key={i}
              label={p.canonical || p.pain || p.name || ''}
              frequency={p.frequency ?? null}
              confidence={p.confidence ?? null}
              evidence={p.evidence}
              category={p.category}
              isDark={isDark}
              accent="#EF4444"
            />
          ))}
        </View>
      )}

      {/* Desire Map */}
      {normalized.desireMap.length > 0 && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <View style={styles.cardHeader}>
            <Ionicons name="heart-outline" size={16} color="#EC4899" />
            <Text style={[styles.cardTitle, { color: colors.text }]}>Desire Map</Text>
            <View style={[styles.headerBadge, { backgroundColor: '#EC489915' }]}>
              <Text style={[styles.headerBadgeText, { color: '#EC4899' }]}>{normalized.desireMap.length}</Text>
            </View>
          </View>
          {normalized.desireMap.map((d: DesireItem, i: number) => (
            <SignalItem
              key={i}
              label={d.canonical || d.desire || d.name || ''}
              frequency={d.frequency ?? null}
              confidence={d.confidence ?? null}
              evidence={d.evidence}
              isDark={isDark}
              accent="#EC4899"
            />
          ))}
        </View>
      )}

      {/* Objection Map */}
      {objections.length > 0 && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <View style={styles.cardHeader}>
            <Ionicons name="hand-left-outline" size={16} color="#F59E0B" />
            <Text style={[styles.cardTitle, { color: colors.text }]}>Objections</Text>
            <View style={[styles.headerBadge, { backgroundColor: '#F59E0B15' }]}>
              <Text style={[styles.headerBadgeText, { color: '#F59E0B' }]}>{objections.length}</Text>
            </View>
          </View>
          {objections.map((o: ObjectionItem, i: number) => (
            <SignalItem
              key={i}
              label={o.canonical || o.objection || o.name || ''}
              frequency={o.frequency ?? null}
              confidence={o.confidence ?? null}
              evidence={o.evidence}
              category={o.category}
              isDark={isDark}
              accent="#F59E0B"
            />
          ))}
        </View>
      )}

      {/* Emotional Drivers */}
      {normalized.emotionalDrivers.length > 0 && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <View style={styles.cardHeader}>
            <Ionicons name="flame-outline" size={16} color="#F97316" />
            <Text style={[styles.cardTitle, { color: colors.text }]}>Emotional Drivers</Text>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {normalized.emotionalDrivers.map((e: EmotionalDriver, i: number) => (
              <View key={i} style={[styles.driverPill, { backgroundColor: '#F9731615' }]}>
                <Text style={[styles.driverText, { color: '#F97316' }]}>
                  {e.driver || e.name || ''}
                  {typeof e.frequency === 'number' && ` · ${e.frequency}`}
                  {typeof e.confidence === 'number' && ` · ${pct(e.confidence)}`}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Audience Segments */}
      {normalized.audienceSegments.length > 0 && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <View style={styles.cardHeader}>
            <Ionicons name="people-circle-outline" size={16} color="#3B82F6" />
            <Text style={[styles.cardTitle, { color: colors.text }]}>Audience Segments</Text>
            <View style={[styles.headerBadge, { backgroundColor: '#3B82F615' }]}>
              <Text style={[styles.headerBadgeText, { color: '#3B82F6' }]}>{normalized.audienceSegments.length}</Text>
            </View>
          </View>
          {normalized.audienceSegments.map((seg: AudienceSegment, i: number) => (
            <View key={i} style={[styles.segment, isDark && { borderColor: '#374151' }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={[styles.segmentName, { color: colors.text }]}>{seg.name || `Segment ${i + 1}`}</Text>
                {typeof seg.density === 'number' && (
                  <View style={[styles.miniTag, { backgroundColor: '#3B82F615' }]}>
                    <Text style={[styles.miniTagText, { color: '#3B82F6' }]}>density {pct(seg.density)}</Text>
                  </View>
                )}
              </View>
              {seg.description && (
                <Text style={[styles.segmentDesc, { color: colors.textMuted }]}>{seg.description}</Text>
              )}
              {Array.isArray(seg.painProfile) && seg.painProfile.length > 0 && (
                <Text style={[styles.segmentMeta, { color: colors.textMuted }]}>Pains: {seg.painProfile.join(' · ')}</Text>
              )}
              {Array.isArray(seg.desireProfile) && seg.desireProfile.length > 0 && (
                <Text style={[styles.segmentMeta, { color: colors.textMuted }]}>Desires: {seg.desireProfile.join(' · ')}</Text>
              )}
              {Array.isArray(seg.objectionProfile) && seg.objectionProfile.length > 0 && (
                <Text style={[styles.segmentMeta, { color: colors.textMuted }]}>Objections: {seg.objectionProfile.join(' · ')}</Text>
              )}
            </View>
          ))}
        </View>
      )}

      {/* Transformation Map */}
      {normalized.transformationMap.length > 0 && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <View style={styles.cardHeader}>
            <Ionicons name="swap-horizontal" size={16} color="#10B981" />
            <Text style={[styles.cardTitle, { color: colors.text }]}>Transformation Map (Before → After)</Text>
          </View>
          {normalized.transformationMap.map((t: TransformationMapItem, i: number) => (
            <View key={i} style={[styles.transformRow, isDark && { borderColor: '#374151' }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 10, color: colors.textMuted, fontWeight: '600' }}>BEFORE</Text>
                <Text style={[styles.signalText, { color: colors.text }]}>{t.before || '—'}</Text>
              </View>
              <Ionicons name="arrow-forward" size={14} color="#10B981" style={{ marginHorizontal: 6 }} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 10, color: colors.textMuted, fontWeight: '600' }}>AFTER</Text>
                <Text style={[styles.signalText, { color: colors.text }]}>{t.after || '—'}</Text>
              </View>
              {t.axis && (
                <View style={[styles.miniTag, { backgroundColor: '#10B98115', alignSelf: 'flex-start', marginLeft: 6 }]}>
                  <Text style={[styles.miniTagText, { color: '#10B981' }]}>{t.axis}</Text>
                </View>
              )}
            </View>
          ))}
        </View>
      )}

      {/* Structured Signals — Pain Clusters */}
      {Array.isArray(painClusters) && painClusters.length > 0 && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <View style={styles.cardHeader}>
            <Ionicons name="git-network-outline" size={16} color="#8B5CF6" />
            <Text style={[styles.cardTitle, { color: colors.text }]}>Pain Clusters (MI v3)</Text>
          </View>
          {painClusters.map((c: PainCluster, i: number) => (
            <View key={i} style={[styles.signalItem, isDark && styles.signalItemDark]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                {c.id && (
                  <View style={[styles.miniTag, { backgroundColor: '#8B5CF620' }]}>
                    <Text style={[styles.miniTagText, { color: '#5B21B6', fontWeight: '700' }]}>{c.id}</Text>
                  </View>
                )}
                {typeof c.frequency === 'number' && (
                  <View style={[styles.miniTag, { backgroundColor: '#6366F115' }]}>
                    <Text style={[styles.miniTagText, { color: '#6366F1' }]}>freq {c.frequency}</Text>
                  </View>
                )}
                {typeof c.confidence === 'number' && (
                  <View style={[styles.miniTag, { backgroundColor: '#10B98115' }]}>
                    <Text style={[styles.miniTagText, { color: '#10B981' }]}>conf {pct(c.confidence)}</Text>
                  </View>
                )}
              </View>
              <Text style={[styles.signalText, isDark && styles.textLight]}>{c.label || ''}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Footer metadata */}
      <View style={{ marginTop: 12, paddingHorizontal: 4, gap: 2 }}>
        {normalized.engineVersion && (
          <Text style={{ fontSize: 10, color: colors.textMuted }}>Engine v{normalized.engineVersion}</Text>
        )}
        {normalized.executionTimeMs && (
          <Text style={{ fontSize: 10, color: colors.textMuted }}>Runtime: {normalized.executionTimeMs}ms</Text>
        )}
        {normalized.createdAt && (
          <Text style={{ fontSize: 10, color: colors.textMuted }}>Generated: {new Date(normalized.createdAt).toLocaleString()}</Text>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  empty: { padding: 24, borderRadius: 12, alignItems: 'center', gap: 8, marginTop: 12 },
  emptyText: { fontSize: 13 },
  card: {
    padding: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  cardTitle: { fontSize: 13, fontWeight: '700' },
  headerBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, marginLeft: 'auto' as any },
  headerBadgeText: { fontSize: 10, fontWeight: '700' },
  signalItem: {
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E7EB',
    marginTop: 6,
  },
  signalItemDark: { borderTopColor: '#374151' },
  signalText: { fontSize: 12, marginTop: 4, lineHeight: 16 },
  evidenceText: { fontSize: 10, fontStyle: 'italic', color: '#9CA3AF' },
  miniTag: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 3 },
  miniTagText: { fontSize: 9, fontWeight: '600' },
  driverPill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4 },
  driverText: { fontSize: 11, fontWeight: '600' },
  segment: {
    paddingVertical: 8,
    paddingHorizontal: 8,
    marginTop: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    borderColor: '#E5E7EB',
    gap: 4,
  },
  segmentName: { fontSize: 12, fontWeight: '700' },
  segmentDesc: { fontSize: 11, lineHeight: 14 },
  segmentMeta: { fontSize: 10, fontStyle: 'italic' },
  transformRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E7EB',
    marginTop: 6,
  },
  textLight: { color: '#F9FAFB' },
});
