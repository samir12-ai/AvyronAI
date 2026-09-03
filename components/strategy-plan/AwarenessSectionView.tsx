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
  const awareness = sections.awareness || {};
  const businessRep = sections.businessRepresentation;
  const stratSummary = sections.strategicSummary;

  const narrativeReframe = awareness.narrativeReframe || awareness.reframe || stratSummary?.strategy || businessRep?.strategicSummary?.strategy || 'Transitioning from unverified market noise to continuous signal intelligence.';
  const currentBelief = awareness.currentBelief || awareness.oldBelief || 'Most growth strategies rely on guesswork, manual research, and static competitive audits.';
  const desiredBelief = awareness.desiredBelief || awareness.newBelief || 'Winning market strategies require continuous real-time market signals and verified customer evidence.';

  const mythBreakers: Array<{ myth: string; reality: string }> = React.useMemo(() => {
    if (Array.isArray(awareness.mythBreakers) && awareness.mythBreakers.length > 0) {
      return awareness.mythBreakers.map((m: any) => ({
        myth: m.myth || m.falseAssumption || 'Manual market research is sufficient for modern GTM speed.',
        reality: m.reality || m.truth || m.reframe || 'Manual research decays rapidly; real-time competitive mirrors maintain targeting precision.',
      }));
    }
    return [
      {
        myth: 'More content volume automatically drives qualified customer acquisition.',
        reality: 'Only content addressing verified buying pains and defended against competitor saturation converts high-intent buyers.',
      },
      {
        myth: 'Market positioning is a one-time branding exercise.',
        reality: 'Market territories evolve continuously; live signal tracking prevents narrative drift and wasted media spend.',
      }
    ];
  }, [awareness]);

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
            <Text style={styles.statusText}>Strategic Mindset Shift</Text>
          </View>
        </View>

        <Text style={styles.heroTitle}>Strategic Narrative Reframe</Text>
        <Text style={styles.heroDescription}>"{narrativeReframe}"</Text>

        {/* Belief Transformation Box */}
        <View style={styles.beliefContainer}>
          <View style={styles.beliefBoxOld}>
            <View style={styles.beliefHeader}>
              <Feather name="x-circle" size={12} color="#EF4444" style={{ marginRight: 5 }} />
              <Text style={styles.beliefLabelOld}>CURRENT MARKET ASSUMPTION</Text>
            </View>
            <Text style={styles.beliefTextOld}>{currentBelief}</Text>
          </View>

          <View style={styles.beliefArrowWrap}>
            <Feather name="arrow-down" size={16} color="#8B5CF6" />
          </View>

          <View style={styles.beliefBoxNew}>
            <View style={styles.beliefHeader}>
              <Feather name="check-circle" size={12} color="#10B981" style={{ marginRight: 5 }} />
              <Text style={styles.beliefLabelNew}>REQUIRED STRATEGIC MINDSET</Text>
            </View>
            <Text style={styles.beliefTextNew}>{desiredBelief}</Text>
          </View>
        </View>
      </View>

      {/* ── 2. MYTHS & FALSE ASSUMPTIONS TO BREAK ── */}
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
                  <Text style={styles.mythLabel}>COMMON MYTH</Text>
                  <Text style={styles.mythText}>"{item.myth}"</Text>
                </View>
              </View>

              <View style={styles.realityRow}>
                <View style={styles.realityIcon}>
                  <Feather name="check" size={12} color="#10B981" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.realityLabel}>STRATEGIC TRUTH</Text>
                  <Text style={styles.realityText}>{item.reality}</Text>
                </View>
              </View>
            </View>
          ))}
        </View>
      </View>

      {/* ── 3. TOP OF FUNNEL ENTRY LOGIC ── */}
      <View style={styles.entryCard}>
        <View style={styles.entryHeader}>
          <Feather name="compass" size={14} color="#38BDF8" style={{ marginRight: 6 }} />
          <Text style={styles.entryTitle}>TOP-OF-FUNNEL ENTRY LOGIC</Text>
        </View>
        <Text style={styles.entryBody}>
          Target prospects are initially addressed at the problem-agitation stage: exposing the operational friction of unverified targeting before introducing product capabilities.
        </Text>
      </View>

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
              <Text style={styles.evidenceLabel}>ENGINE PRIORITY</Text>
              <Text style={styles.evidenceValue}>
                MESSAGING Tier (#7) · Derived from verified audience objections and contrast axes.
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
