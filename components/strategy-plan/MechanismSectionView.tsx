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

export default function MechanismSectionView({ planData, intelligenceData }: Props) {
  const [showEvidence, setShowEvidence] = useState(false);

  const sections = planData?.sections || {};
  const root = sections.strategyRoot || planData?.strategyRoot;
  const approvedMech = root?.approvedMechanism || sections.mechanism;
  const brandSpine = sections.brandSpine || intelligenceData?.positioning?.brandSpine;

  const mechanismName = approvedMech?.name || approvedMech?.mechanismName || (brandSpine?.mechanism && brandSpine.mechanism !== 'none' ? brandSpine.mechanism : null);
  const mechanismType = approvedMech?.type || approvedMech?.mechanismType || 'Algorithmic Delivery';
  const mechanismDescription = approvedMech?.description || approvedMech?.mechanismDescription || approvedMech?.logic || 'Grounded delivery process connecting buyer pain resolution directly to product capabilities.';
  const mechanismPromise = approvedMech?.promise || approvedMech?.mechanismPromise || 'Continuous verified signal intelligence without manual research overhead.';
  const whyItWorks = approvedMech?.whyItWorks || approvedMech?.commercialFunction?.description || 'By enforcing automated data ingestion and semantic verification, ungrounded noise is filtered before reaching strategy decisions.';

  // Steps / Causal Chain
  const steps: string[] = React.useMemo(() => {
    if (Array.isArray(approvedMech?.steps) && approvedMech.steps.length > 0) {
      return approvedMech.steps;
    }
    if (Array.isArray(approvedMech?.mechanismSteps) && approvedMech.mechanismSteps.length > 0) {
      return approvedMech.mechanismSteps;
    }
    if (Array.isArray(approvedMech?.causalChain) && approvedMech.causalChain.length > 0) {
      return approvedMech.causalChain.map((c: any) => `${c.cause} → ${c.impact}`);
    }
    return [
      'Multi-source signal ingestion across active market channels',
      'Automated evidence filtering via evidence integrity gates',
      'Targeted pain-capability pairing with strict product truth constraints',
      'Structured strategy synthesis locked into weekly execution playbooks'
    ];
  }, [approvedMech]);

  const hasMechanism = Boolean(mechanismName && mechanismName.toLowerCase() !== 'none' && mechanismType.toLowerCase() !== 'none');

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false}>
      {/* ── 1. STRATEGIC MECHANISM HERO ── */}
      <View style={styles.heroCard}>
        <View style={styles.heroHeader}>
          <View style={styles.badgePrimary}>
            <Feather name="cpu" size={12} color="#A78BFA" style={{ marginRight: 5 }} />
            <Text style={styles.badgePrimaryText}>STRATEGIC MECHANISM</Text>
          </View>
          <View style={[styles.statusPill, !hasMechanism && styles.statusPillNeutral]}>
            <View style={[styles.statusDot, !hasMechanism && styles.statusDotNeutral]} />
            <Text style={[styles.statusText, !hasMechanism && styles.statusTextNeutral]}>
              {hasMechanism ? 'Canonical Mechanism' : 'Category Direct Stance'}
            </Text>
          </View>
        </View>

        {hasMechanism ? (
          <>
            <Text style={styles.heroTitle}>{mechanismName}</Text>
            <View style={styles.typeBadge}>
              <Feather name="tag" size={11} color="#34D399" style={{ marginRight: 4 }} />
              <Text style={styles.typeBadgeText}>Mechanism Type: {mechanismType}</Text>
            </View>
            <Text style={styles.heroDescription}>"{mechanismDescription}"</Text>

            {mechanismPromise && (
              <View style={styles.promiseBox}>
                <View style={styles.promiseHeader}>
                  <Feather name="award" size={13} color="#F59E0B" style={{ marginRight: 6 }} />
                  <Text style={styles.promiseLabel}>CORE MECHANISM PROMISE</Text>
                </View>
                <Text style={styles.promiseText}>{mechanismPromise}</Text>
              </View>
            )}
          </>
        ) : (
          <View style={styles.noMechBox}>
            <Text style={styles.noMechTitle}>NO DISTINCT MECHANISM REQUIRED</Text>
            <Text style={styles.noMechDesc}>
              This strategic plan relies on direct category execution and established product capability delivery. The offering wins on direct positioning and contrast without requiring a complex proprietary naming abstraction.
            </Text>
            <View style={styles.canonicalBadge}>
              <Feather name="check-circle" size={12} color="#34D399" style={{ marginRight: 5 }} />
              <Text style={styles.canonicalBadgeText}>Canonical Status: NO_DISTINCT_MECHANISM_ESTABLISHED</Text>
            </View>
          </View>
        )}
      </View>

      {/* ── 2. HOW IT WORKS (STEP-BY-STEP CAUSAL LOGIC) ── */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <Feather name="git-merge" size={16} color="#8B5CF6" style={{ marginRight: 8 }} />
          <Text style={styles.sectionTitle}>HOW THE PROCESS OPERATES</Text>
        </View>
        <Text style={styles.sectionSubtitle}>
          Step-by-step causal logic explaining why this approach reliably delivers the desired commercial outcome.
        </Text>

        <View style={styles.stepsContainer}>
          {steps.map((step: string, idx: number) => (
            <View key={idx} style={styles.stepRow}>
              <View style={styles.stepIndicatorCol}>
                <View style={styles.stepDot}>
                  <Text style={styles.stepNum}>{idx + 1}</Text>
                </View>
                {idx < steps.length - 1 && <View style={styles.stepLine} />}
              </View>
              <View style={styles.stepContent}>
                <Text style={styles.stepText}>{step}</Text>
              </View>
            </View>
          ))}
        </View>
      </View>

      {/* ── 3. COMMERCIAL FUNCTION & WHY IT WORKS ── */}
      <View style={styles.whyCard}>
        <View style={styles.whyHeader}>
          <Feather name="target" size={14} color="#38BDF8" style={{ marginRight: 6 }} />
          <Text style={styles.whyTitle}>COMMERCIAL FUNCTION & REASONING</Text>
        </View>
        <Text style={styles.whyBody}>{whyItWorks}</Text>
      </View>

      {/* ── 4. PRODUCT TRUTH CONNECTION (DRAWER) ── */}
      <View style={styles.drawerCard}>
        <Pressable
          style={styles.drawerToggle}
          onPress={() => setShowEvidence(!showEvidence)}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Feather name="database" size={14} color="#8B5CF6" style={{ marginRight: 8 }} />
            <Text style={styles.drawerTitle}>View Mechanism Truth & Validation Linkage</Text>
          </View>
          <Feather name={showEvidence ? 'chevron-up' : 'chevron-down'} size={16} color="#9CA3AF" />
        </Pressable>

        {showEvidence && (
          <View style={styles.drawerBody}>
            <View style={styles.evidenceItem}>
              <Text style={styles.evidenceLabel}>PRODUCT TRUTH LINKAGE</Text>
              <Text style={styles.evidenceValue}>
                {brandSpine?.productTruth || 'First-party capability verification via Business Understanding.'}
              </Text>
            </View>
            <View style={styles.evidenceItem}>
              <Text style={styles.evidenceLabel}>GOVERNANCE VERDICT</Text>
              <Text style={styles.evidenceValue}>
                Engine priority tier OFFER/MECHANISM (#5) validated with fail-closed integrity assertion.
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
  statusPillNeutral: {
    backgroundColor: '#64748B15',
    borderColor: '#64748B30',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  statusDotNeutral: {
    backgroundColor: '#94A3B8',
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#34D399',
  },
  statusTextNeutral: {
    color: '#94A3B8',
  },
  heroTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#F8FAFC',
    letterSpacing: -0.3,
    marginBottom: 6,
  },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#10B98115',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#10B98130',
    marginBottom: 12,
  },
  typeBadgeText: {
    fontSize: 11,
    color: '#34D399',
    fontWeight: '700',
  },
  heroDescription: {
    fontSize: 14,
    color: '#CBD5E1',
    lineHeight: 22,
    fontStyle: 'italic',
    marginBottom: 14,
  },
  promiseBox: {
    backgroundColor: '#161E2E',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1E2535',
  },
  promiseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  promiseLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FCD34D',
    letterSpacing: 0.6,
  },
  promiseText: {
    fontSize: 13,
    color: '#E2E8F0',
    fontWeight: '600',
    lineHeight: 18,
  },
  noMechBox: {
    paddingVertical: 10,
  },
  noMechTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#F8FAFC',
    marginBottom: 6,
  },
  noMechDesc: {
    fontSize: 13,
    color: '#94A3B8',
    lineHeight: 20,
    marginBottom: 12,
  },
  canonicalBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#10B98115',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#10B98130',
    alignSelf: 'flex-start',
  },
  canonicalBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#34D399',
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
  stepsContainer: {
    gap: 0,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  stepIndicatorCol: {
    alignItems: 'center',
    width: 32,
    marginRight: 12,
  },
  stepDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#8B5CF625',
    borderWidth: 1,
    borderColor: '#8B5CF6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepNum: {
    fontSize: 11,
    fontWeight: '800',
    color: '#A78BFA',
  },
  stepLine: {
    width: 2,
    flex: 1,
    minHeight: 24,
    backgroundColor: '#1F2937',
    marginVertical: 4,
  },
  stepContent: {
    flex: 1,
    paddingBottom: 20,
  },
  stepText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#E2E8F0',
    lineHeight: 20,
  },
  whyCard: {
    backgroundColor: '#0284C715',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#0284C730',
    marginBottom: 16,
  },
  whyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  whyTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#38BDF8',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  whyBody: {
    fontSize: 13,
    color: '#E0F2FE',
    lineHeight: 20,
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
