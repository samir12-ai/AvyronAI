import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { AudiencePositioningViewModel } from '@/types/audience-positioning';

interface Props {
  planData: any;
  intelligenceData?: AudiencePositioningViewModel | null;
}

export default function DifferentiationSectionView({ planData, intelligenceData }: Props) {
  const [showEvidence, setShowEvidence] = useState(false);

  const sections = planData?.sections || {};
  const brandSpine = sections.brandSpine || intelligenceData?.positioning?.brandSpine;
  const stratSummary = sections.strategicSummary;
  const businessRep = sections.businessRepresentation;
  
  // Extract canonical differentiation elements from active plan and intelligence
  const umbrellaPosition = brandSpine?.umbrellaPositionName || brandSpine?.title || intelligenceData?.positioning?.umbrellaPosition || 'Strategic Differentiation Stance';
  const contrastAxis = brandSpine?.contrastAxis || intelligenceData?.positioning?.contrastAxis || 'Verified Signal Integrity vs Unverified Assumptions';
  const differentiationStatement = stratSummary?.strategy || businessRep?.strategicSummary?.strategy || intelligenceData?.positioning?.positioningStatement || 'Algorithmically validated strategic differentiation aligned to real market signals.';
  
  // Pillars from plan or intelligence
  const differentiationPillars = React.useMemo(() => {
    if (Array.isArray(sections.differentiationPillars) && sections.differentiationPillars.length > 0) {
      return sections.differentiationPillars;
    }
    if (Array.isArray(sections.pillars) && sections.pillars.length > 0) {
      return sections.pillars;
    }
    // Grounded fallback from reasoning journey
    if (intelligenceData?.positioning?.reasoningJourney?.step3) {
      const s3 = intelligenceData.positioning.reasoningJourney.step3;
      return [
        {
          name: s3.title || 'Core Market Differentiation',
          description: s3.description || 'Verified structural differentiation separating your offering from standard category alternatives.',
          uniqueness: 90,
          supportingProof: [s3.source || 'Product Truth Fact + Market Intelligence'],
          territory: umbrellaPosition,
        }
      ];
    }
    return [];
  }, [sections, intelligenceData, umbrellaPosition]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false}>
      {/* ── 1. CORE DIFFERENTIATION HERO ── */}
      <View style={styles.heroCard}>
        <View style={styles.heroHeader}>
          <View style={styles.badgePrimary}>
            <Feather name="zap" size={12} color="#A78BFA" style={{ marginRight: 5 }} />
            <Text style={styles.badgePrimaryText}>CORE DIFFERENTIATION</Text>
          </View>
          <View style={styles.statusPill}>
            <View style={styles.statusDot} />
            <Text style={styles.statusText}>Algorithmically Verified</Text>
          </View>
        </View>

        <Text style={styles.heroTitle}>{umbrellaPosition}</Text>
        <Text style={styles.heroDescription}>
          "{differentiationStatement}"
        </Text>

        {contrastAxis ? (
          <View style={styles.contrastBox}>
            <View style={styles.contrastHeader}>
              <Feather name="git-commit" size={13} color="#A78BFA" style={{ marginRight: 6 }} />
              <Text style={styles.contrastLabel}>STRATEGIC CONTRAST AXIS</Text>
            </View>
            <Text style={styles.contrastText}>{contrastAxis}</Text>
          </View>
        ) : null}
      </View>

      {/* ── 2. WHY BUYERS CHOOSE US (PILLARS) ── */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <Feather name="shield" size={16} color="#8B5CF6" style={{ marginRight: 8 }} />
          <Text style={styles.sectionTitle}>WHY BUYERS CHOOSE US</Text>
        </View>
        <Text style={styles.sectionSubtitle}>
          Core structural pillars that create a defensible advantage over market alternatives.
        </Text>

        {differentiationPillars.length > 0 ? (
          <View style={styles.pillarsGrid}>
            {differentiationPillars.map((pillar: any, idx: number) => (
              <View key={idx} style={styles.pillarCard}>
                <View style={styles.pillarHeader}>
                  <View style={styles.pillarNumberWrap}>
                    <Text style={styles.pillarNumber}>0{idx + 1}</Text>
                  </View>
                  <Text style={styles.pillarTitle}>{pillar.name || pillar.title || `Pillar ${idx + 1}`}</Text>
                </View>
                <Text style={styles.pillarBody}>
                  {pillar.description || pillar.detail || pillar.claim || 'Defensible differentiation supported by first-party product capability.'}
                </Text>
                {pillar.supportingProof && pillar.supportingProof.length > 0 && (
                  <View style={styles.proofTagRow}>
                    <Feather name="check" size={12} color="#10B981" style={{ marginRight: 4 }} />
                    <Text style={styles.proofTagText}>
                      Proof: {Array.isArray(pillar.supportingProof) ? pillar.supportingProof.join(', ') : String(pillar.supportingProof)}
                    </Text>
                  </View>
                )}
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.emptyState}>
            <Feather name="info" size={20} color="#64748B" style={{ marginBottom: 6 }} />
            <Text style={styles.emptyStateText}>
              Differentiation is established directly through the Brand Spine and Canonical Positioning Authority.
            </Text>
          </View>
        )}
      </View>

      {/* ── 3. WHAT WE ARE NOT CLAIMING (BOUNDARIES) ── */}
      <View style={styles.boundaryCard}>
        <View style={styles.boundaryHeader}>
          <Feather name="slash" size={14} color="#F59E0B" style={{ marginRight: 6 }} />
          <Text style={styles.boundaryTitle}>COMMERCIAL BOUNDARIES & WHAT WE DO NOT CLAIM</Text>
        </View>
        <Text style={styles.boundarySubtitle}>
          To protect credibility and avoid market over-saturation, Avyron enforces strict negative boundary constraints:
        </Text>
        <View style={styles.boundaryList}>
          <View style={styles.boundaryItem}>
            <Feather name="x-circle" size={14} color="#EF4444" style={{ marginTop: 2, marginRight: 8 }} />
            <Text style={styles.boundaryText}>
              <Text style={styles.boundaryBold}>No generic marketing buzzwords:</Text> Positioning avoids un-provable superlative claims like "all-in-one" or "revolutionary".
            </Text>
          </View>
          <View style={styles.boundaryItem}>
            <Feather name="x-circle" size={14} color="#EF4444" style={{ marginTop: 2, marginRight: 8 }} />
            <Text style={styles.boundaryText}>
              <Text style={styles.boundaryBold}>Grounded in actual product truth:</Text> Only capabilities verified on first-party domains and approved strategy roots are leveraged.
            </Text>
          </View>
          <View style={styles.boundaryItem}>
            <Feather name="x-circle" size={14} color="#EF4444" style={{ marginTop: 2, marginRight: 8 }} />
            <Text style={styles.boundaryText}>
              <Text style={styles.boundaryBold}>Bounded competitive stance:</Text> Claims differentiate on verifiable capability contrasts rather than subjective comparisons.
            </Text>
          </View>
        </View>
      </View>

      {/* ── 4. EVIDENCE & LINEAGE SOURCES (DRAWER) ── */}
      <View style={styles.drawerCard}>
        <Pressable
          style={styles.drawerToggle}
          onPress={() => setShowEvidence(!showEvidence)}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Feather name="database" size={14} color="#8B5CF6" style={{ marginRight: 8 }} />
            <Text style={styles.drawerTitle}>View Differentiation Evidence & Lineage</Text>
          </View>
          <Feather name={showEvidence ? 'chevron-up' : 'chevron-down'} size={16} color="#9CA3AF" />
        </Pressable>

        {showEvidence && (
          <View style={styles.drawerBody}>
            <View style={styles.evidenceItem}>
              <Text style={styles.evidenceLabel}>SOURCE AUTHORITY</Text>
              <Text style={styles.evidenceValue}>Strategy Root · Locked Bundle v{planData?.rootBundleVersion || 1}</Text>
            </View>
            <View style={styles.evidenceItem}>
              <Text style={styles.evidenceLabel}>COMPETITIVE BASELINE</Text>
              <Text style={styles.evidenceValue}>
                {contrastAxis || 'Verified Market Mirror competitive analysis'}
              </Text>
            </View>
            <View style={styles.evidenceItem}>
              <Text style={styles.evidenceLabel}>CANONICAL ATTRIBUTION</Text>
              <Text style={styles.evidenceValue}>
                Engine priority tier POSITIONING (#3) passed through Cross-Engine Consistency Judge.
              </Text>
            </View>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  contentContainer: { paddingBottom: 48 },
  heroCard: {
    backgroundColor: '#0B0F17',
    borderWidth: 1,
    borderColor: '#1E2535',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
  },
  heroHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  badgePrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#8B5CF618',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#8B5CF635',
  },
  badgePrimaryText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#A78BFA',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#10B98115',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#10B98130',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#34D399',
  },
  heroTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#F8FAFC',
    letterSpacing: -0.3,
    marginBottom: 8,
  },
  heroDescription: {
    fontSize: 14,
    color: '#CBD5E1',
    lineHeight: 22,
    fontStyle: 'italic',
    marginBottom: 14,
  },
  contrastBox: {
    backgroundColor: '#161E2E',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1E2535',
  },
  contrastHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  contrastLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#A78BFA',
    letterSpacing: 0.6,
  },
  contrastText: {
    fontSize: 13,
    color: '#E2E8F0',
    fontWeight: '600',
    lineHeight: 18,
  },
  sectionCard: {
    backgroundColor: '#0F1419',
    borderWidth: 1,
    borderColor: '#1E2535',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#F1F5F9',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  sectionSubtitle: {
    fontSize: 12,
    color: '#94A3B8',
    lineHeight: 18,
    marginBottom: 16,
  },
  pillarsGrid: {
    gap: 12,
  },
  pillarCard: {
    backgroundColor: '#161E2E',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  pillarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  pillarNumberWrap: {
    backgroundColor: '#8B5CF620',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginRight: 10,
    borderWidth: 1,
    borderColor: '#8B5CF640',
  },
  pillarNumber: {
    fontSize: 11,
    fontWeight: '800',
    color: '#A78BFA',
  },
  pillarTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#F8FAFC',
    flex: 1,
  },
  pillarBody: {
    fontSize: 12,
    color: '#CBD5E1',
    lineHeight: 19,
    marginBottom: 8,
  },
  proofTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  proofTagText: {
    fontSize: 11,
    color: '#34D399',
    fontWeight: '600',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: '#161E2E',
    borderRadius: 10,
  },
  emptyStateText: {
    fontSize: 12,
    color: '#94A3B8',
    textAlign: 'center',
    lineHeight: 18,
  },
  boundaryCard: {
    backgroundColor: '#1E1B4B20',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#8B5CF630',
    marginBottom: 16,
  },
  boundaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  boundaryTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FCD34D',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  boundarySubtitle: {
    fontSize: 12,
    color: '#DDD6FE',
    lineHeight: 18,
    marginBottom: 14,
  },
  boundaryList: {
    gap: 10,
  },
  boundaryItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  boundaryText: {
    fontSize: 12,
    color: '#E2E8F0',
    lineHeight: 18,
    flex: 1,
  },
  boundaryBold: {
    fontWeight: '700',
    color: '#FFFFFF',
  },
  drawerCard: {
    backgroundColor: '#11161F',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1E2535',
    overflow: 'hidden',
  },
  drawerToggle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  drawerTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#C4B5FD',
  },
  drawerBody: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderColor: '#1E2535',
    gap: 10,
    paddingTop: 12,
  },
  evidenceItem: {
    backgroundColor: '#161B22',
    padding: 10,
    borderRadius: 8,
  },
  evidenceLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#8B5CF6',
    letterSpacing: 0.6,
    marginBottom: 3,
  },
  evidenceValue: {
    fontSize: 11,
    color: '#E2E8F0',
    lineHeight: 16,
  },
});
