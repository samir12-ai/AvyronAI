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

export default function AwarenessSectionView({ planData, intelligenceData }: Props) {
  const [showEvidence, setShowEvidence] = useState(false);

  const sections = planData?.sections || {};
  const rawAwareness = sections.awareness || planData?.awareness || {};
  const primaryRoute = rawAwareness.primaryRoute || rawAwareness;

  const reframeObj =
    (typeof primaryRoute.narrativeReframe === 'object' && primaryRoute.narrativeReframe !== null ? primaryRoute.narrativeReframe : null) ||
    (typeof rawAwareness.narrativeReframeDetails === 'object' && rawAwareness.narrativeReframeDetails !== null ? rawAwareness.narrativeReframeDetails : null) ||
    (typeof rawAwareness.narrativeReframe === 'object' && rawAwareness.narrativeReframe !== null ? rawAwareness.narrativeReframe : null);
  const mythObj =
    (typeof primaryRoute.mythBreaker === 'object' && primaryRoute.mythBreaker !== null ? primaryRoute.mythBreaker : null) ||
    (typeof rawAwareness.mythBreakerDetails === 'object' && rawAwareness.mythBreakerDetails !== null ? rawAwareness.mythBreakerDetails : null) ||
    (typeof rawAwareness.mythBreaker === 'object' && rawAwareness.mythBreaker !== null ? rawAwareness.mythBreaker : null);

  const routeName = String(primaryRoute.routeName || primaryRoute.name || rawAwareness.routeName || sections.awarenessRoute || '');
  const entryStage = String(primaryRoute.entryStage || primaryRoute.entryMechanismType || rawAwareness.entryStage || '');
  const targetReadinessStage = String(primaryRoute.targetReadinessStage || rawAwareness.targetReadinessStage || '');

  const currentBelief = String(
    primaryRoute.oldBelief ||
    rawAwareness.oldBelief ||
    primaryRoute.currentBelief ||
    rawAwareness.currentBelief ||
    reframeObj?.currentModel?.statement ||
    mythObj?.beliefToContradict ||
    ''
  );
  const desiredBelief = String(
    primaryRoute.newBelief ||
    rawAwareness.newBelief ||
    primaryRoute.desiredBelief ||
    rawAwareness.desiredBelief ||
    reframeObj?.newModel?.reclassification ||
    mythObj?.mythBreakerStatement ||
    ''
  );
  const narrativeReframe = String(
    (typeof primaryRoute.narrativeReframe === 'string' ? primaryRoute.narrativeReframe : '') ||
    (typeof rawAwareness.narrativeReframe === 'string' ? rawAwareness.narrativeReframe : '') ||
    (reframeObj?.newModel?.namedPrinciple
      ? `${reframeObj.newModel.namedPrinciple}: ${reframeObj.newModel.reclassification || desiredBelief}`
      : '') ||
    reframeObj?.bridgeMechanism?.specificMove ||
    mythObj?.mythBreakerStatement ||
    primaryRoute.reframe ||
    rawAwareness.reframe ||
    ''
  );
  const entryLogic = String(
    primaryRoute.entryLogic ||
    rawAwareness.entryLogic ||
    reframeObj?.bridgeMechanism?.specificMove ||
    mythObj?.contradictionLogic ||
    primaryRoute.trustRequirement ||
    primaryRoute.audienceFraming ||
    rawAwareness.audienceFraming ||
    ''
  );
  const audienceFraming = String(
    primaryRoute.audienceFraming ||
    rawAwareness.audienceFraming ||
    primaryRoute.funnelCompatibility ||
    reframeObj?.discomfortCost?.privateAdmission ||
    ''
  );

  const mythBreakers: Array<{ myth: string; reality: string }> = React.useMemo(() => {
    const rawList = Array.isArray(primaryRoute.mythBreakers) && primaryRoute.mythBreakers.length > 0
      ? primaryRoute.mythBreakers
      : Array.isArray(rawAwareness.mythBreakers) && rawAwareness.mythBreakers.length > 0
        ? rawAwareness.mythBreakers
        : [];
    if (rawList.length > 0) {
      return rawList.map((m: any) => {
        if (typeof m === 'string') {
          return {
            myth: currentBelief || 'Conventional category assumption held by skeptical buyers',
            reality: m,
          };
        }
        return {
          myth: String(m.myth || m.falseAssumption || m.beliefToContradict || currentBelief || 'Unverified market assumption'),
          reality: String(m.reality || m.truth || m.reframe || m.mythBreakerStatement || desiredBelief || ''),
        };
      });
    }
    if (mythObj && (mythObj.mythBreakerStatement || mythObj.beliefToContradict)) {
      return [
        {
          myth: String(mythObj.beliefToContradict || currentBelief || 'Conventional category assumption held by skeptical buyers'),
          reality: String(mythObj.mythBreakerStatement || desiredBelief || ''),
        },
      ];
    }
    const singleMythBreaker =
      (typeof primaryRoute.mythBreaker === 'string' ? primaryRoute.mythBreaker : '') ||
      (typeof rawAwareness.mythBreaker === 'string' ? rawAwareness.mythBreaker : '');
    if (singleMythBreaker) {
      return [
        {
          myth: currentBelief || 'Conventional category assumption held by skeptical buyers',
          reality: String(singleMythBreaker),
        },
      ];
    }
    return [];
  }, [primaryRoute, rawAwareness, mythObj, currentBelief, desiredBelief]);

  const hasAwarenessData = Boolean(routeName || narrativeReframe || currentBelief || desiredBelief);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false}>
      {/* ── 1. NARRATIVE REFRAME HERO ── */}
      <View style={styles.heroCard}>
        <View style={styles.heroHeader}>
          <View style={styles.badgePrimary}>
            <Feather name="eye" size={12} color="#A78BFA" style={{ marginRight: 5 }} />
            <Text style={styles.badgePrimaryText}>MARKET AWARENESS & NARRATIVE</Text>
          </View>
          <View style={styles.statusPill}>
            <View style={styles.statusDot} />
            <Text style={styles.statusText}>
              {entryStage && targetReadinessStage
                ? `${entryStage.replace(/_/g, ' ')} → ${targetReadinessStage.replace(/_/g, ' ')}`
                : 'Strategic Mindset Shift'}
            </Text>
          </View>
        </View>

        {hasAwarenessData ? (
          <>
            <Text style={styles.heroTitle}>{routeName || 'Strategic Narrative Reframe'}</Text>
            {narrativeReframe ? (
              <Text style={styles.heroDescription}>"{narrativeReframe}"</Text>
            ) : null}

            {/* Belief Transformation Box */}
            {(currentBelief || desiredBelief) && (
              <View style={styles.beliefContainer}>
                {currentBelief ? (
                  <View style={styles.beliefBoxOld}>
                    <View style={styles.beliefHeader}>
                      <Feather name="x-circle" size={12} color="#EF4444" style={{ marginRight: 5 }} />
                      <Text style={styles.beliefLabelOld}>CURRENT MARKET ASSUMPTION</Text>
                    </View>
                    <Text style={styles.beliefTextOld}>{currentBelief}</Text>
                  </View>
                ) : null}

                {currentBelief && desiredBelief ? (
                  <View style={styles.beliefArrowWrap}>
                    <Feather name="arrow-down" size={16} color="#8B5CF6" />
                  </View>
                ) : null}

                {desiredBelief ? (
                  <View style={styles.beliefBoxNew}>
                    <View style={styles.beliefHeader}>
                      <Feather name="check-circle" size={12} color="#10B981" style={{ marginRight: 5 }} />
                      <Text style={styles.beliefLabelNew}>REQUIRED STRATEGIC MINDSET</Text>
                    </View>
                    <Text style={styles.beliefTextNew}>{desiredBelief}</Text>
                  </View>
                ) : null}
              </View>
            )}
          </>
        ) : (
          <View style={{ paddingVertical: 8 }}>
            <Text style={styles.heroTitle}>AWARENESS SNAPSHOT NOT AVAILABLE IN PLAN</Text>
            <Text style={styles.heroDescription}>
              No canonical Awareness Engine output is attached to this plan revision.
            </Text>
          </View>
        )}
      </View>

      {/* ── 2. MYTHS & FALSE ASSUMPTIONS TO BREAK ── */}
      {mythBreakers.length > 0 && (
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Feather name="zap" size={16} color="#8B5CF6" style={{ marginRight: 8 }} />
            <Text style={styles.sectionTitle}>MYTHS & ASSUMPTIONS TO CHALLENGE</Text>
          </View>
          <Text style={styles.sectionSubtitle}>
            Key industry misconceptions that content and messaging must dismantle to establish category authority.
          </Text>

          <View style={styles.mythsList}>
            {mythBreakers.map((item, idx) => (
              <View key={idx} style={styles.mythCard}>
                <View style={styles.mythRow}>
                  <View style={styles.mythIcon}>
                    <Text style={styles.mythIconText}>✕</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.mythLabel}>COMMON MYTH / OLD BELIEF</Text>
                    <Text style={styles.mythText}>"{item.myth}"</Text>
                  </View>
                </View>

                <View style={styles.realityRow}>
                  <View style={styles.realityIcon}>
                    <Feather name="check" size={12} color="#10B981" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.realityLabel}>MYTH BREAKER & STRATEGIC TRUTH</Text>
                    <Text style={styles.realityText}>{item.reality}</Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* ── 3. TOP OF FUNNEL ENTRY LOGIC ── */}
      {entryLogic ? (
        <View style={styles.entryCard}>
          <View style={styles.entryHeader}>
            <Feather name="compass" size={14} color="#38BDF8" style={{ marginRight: 6 }} />
            <Text style={styles.entryTitle}>TOP-OF-FUNNEL ENTRY LOGIC</Text>
          </View>
          <Text style={styles.entryBody}>{entryLogic}</Text>
          {audienceFraming && audienceFraming !== entryLogic ? (
            <Text style={[styles.entryBody, { marginTop: 8, opacity: 0.9 }]}>
              Audience Framing: {audienceFraming}
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* ── 4. EVIDENCE & LINEAGE DRAWER ── */}
      <View style={styles.drawerCard}>
        <Pressable
          style={styles.drawerToggle}
          onPress={() => setShowEvidence(!showEvidence)}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Feather name="database" size={14} color="#8B5CF6" style={{ marginRight: 8 }} />
            <Text style={styles.drawerTitle}>View Awareness Engine Lineage</Text>
          </View>
          <Feather name={showEvidence ? 'chevron-up' : 'chevron-down'} size={16} color="#9CA3AF" />
        </Pressable>

        {showEvidence && (
          <View style={styles.drawerBody}>
            <View style={styles.evidenceItem}>
              <Text style={styles.evidenceLabel}>PRIMARY ROUTE & READINESS</Text>
              <Text style={styles.evidenceValue}>
                {routeName || 'Canonical Route'} · {entryStage || 'unaware'} → {targetReadinessStage || 'product_aware'}
              </Text>
            </View>
            <View style={styles.evidenceItem}>
              <Text style={styles.evidenceLabel}>CANONICAL CONSTRAINT</Text>
              <Text style={styles.evidenceValue}>
                Bounded by Product Truth — myth reframes cannot introduce ungrounded capability claims.
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
    marginBottom: 16,
  },
  beliefContainer: {
    gap: 8,
  },
  beliefBoxOld: {
    backgroundColor: '#450A0A18',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#EF444430',
  },
  beliefHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  beliefLabelOld: {
    fontSize: 9,
    fontWeight: '800',
    color: '#F87171',
    letterSpacing: 0.6,
  },
  beliefTextOld: {
    fontSize: 12,
    color: '#FECACA',
    lineHeight: 18,
  },
  beliefArrowWrap: {
    alignItems: 'center',
    paddingVertical: 2,
  },
  beliefBoxNew: {
    backgroundColor: '#064E3B18',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#10B98130',
  },
  beliefLabelNew: {
    fontSize: 9,
    fontWeight: '800',
    color: '#34D399',
    letterSpacing: 0.6,
  },
  beliefTextNew: {
    fontSize: 12,
    color: '#D1FAE5',
    lineHeight: 18,
    fontWeight: '600',
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
  mythsList: {
    gap: 12,
  },
  mythCard: {
    backgroundColor: '#161E2E',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1F2937',
    gap: 10,
  },
  mythRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  mythIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#EF444420',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
    marginTop: 1,
  },
  mythIconText: {
    color: '#EF4444',
    fontSize: 11,
    fontWeight: '800',
  },
  mythLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#F87171',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  mythText: {
    fontSize: 12,
    color: '#E2E8F0',
    lineHeight: 18,
    fontStyle: 'italic',
  },
  realityRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderTopWidth: 1,
    borderColor: '#1E2535',
    paddingTop: 10,
  },
  realityIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#10B98120',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
    marginTop: 1,
  },
  realityLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#34D399',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  realityText: {
    fontSize: 12,
    color: '#F1F5F9',
    lineHeight: 18,
    fontWeight: '600',
  },
  entryCard: {
    backgroundColor: '#0284C715',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#0284C730',
    marginBottom: 16,
  },
  entryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  entryTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#38BDF8',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  entryBody: {
    fontSize: 12,
    color: '#E0F2FE',
    lineHeight: 19,
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
