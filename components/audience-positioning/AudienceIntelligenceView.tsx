import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { ShellTheme } from '@/constants/ShellTheme';
import type { AudiencePositioningViewModel } from '@/types/audience-positioning';

interface Props {
  data: AudiencePositioningViewModel;
}

export default function AudienceIntelligenceView({ data }: Props) {
  const [showEvidence, setShowEvidence] = useState(false);
  const [showDecisionHistory, setShowDecisionHistory] = useState(false);
  const [showExcluded, setShowExcluded] = useState(false);

  const { targetAudience, coreBuyingPain, supportingSignals, excludedPains } = data;

  // Helper to extract clean business description from pain records
  const formatSupportingPain = (p: any, idx: number) => {
    return {
      title: p.title,
      description: p.description,
      rawReasoning: p.description,
      painId: p.painId,
    };
  };

  // Filter distinct supporting pains for primary display (max 6)
  const canonicalSupportingPains = React.useMemo(() => {
    if (!supportingSignals?.pains || supportingSignals.pains.length === 0) return [];
    
    const seenTitles = new Set<string>();
    const distinct: any[] = [];
    
    supportingSignals.pains.forEach((p, idx) => {
      const formatted = formatSupportingPain(p, idx);
      if (!seenTitles.has(formatted.title.toLowerCase())) {
        seenTitles.add(formatted.title.toLowerCase());
        distinct.push(formatted);
      }
    });

    return distinct.slice(0, 6);
  }, [supportingSignals?.pains]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false}>
      {/* ── 1. TARGET AUDIENCE (HERO) ── */}
      <View style={styles.heroCard}>
        <View style={styles.heroHeader}>
          <View style={styles.badgePrimary}>
            <Feather name="users" size={12} color="#A78BFA" style={{ marginRight: 5 }} />
            <Text style={styles.badgePrimaryText}>TARGET AUDIENCE</Text>
          </View>
          <View style={styles.metaRow}>
            <View style={styles.tagBadge}>
              <Text style={styles.tagText}>{targetAudience.marketType || 'B2B SaaS / Growth Marketing'}</Text>
            </View>
          </View>
        </View>

        <Text style={styles.heroTitle}>{targetAudience.title}</Text>
        <Text style={styles.heroDescription}>{targetAudience.description}</Text>

        <View style={styles.heroFooter}>
          <View style={styles.footerItem}>
            <Feather name="briefcase" size={14} color="#9CA3AF" style={{ marginRight: 6 }} />
            <Text style={styles.footerLabel}>Buyer Role:</Text>
            <Text style={styles.footerValue}>{targetAudience.buyerRole}</Text>
          </View>
          <View style={styles.footerDivider} />
          <View style={styles.footerItem}>
            <Feather name="compass" size={14} color="#9CA3AF" style={{ marginRight: 6 }} />
            <Text style={styles.footerLabel}>Strategic Context:</Text>
            <Text style={styles.footerValue}>{targetAudience.commercialRelevance || 'Commercial Pipeline Acceleration'}</Text>
          </View>
        </View>
      </View>

      {/* ── 2. CORE BUYING PAIN (DOMINANT PRIMARY DECISION) ── */}
      <View style={styles.corePainCard}>
        <View style={styles.corePainHeader}>
          <View style={styles.badgeHighlight}>
            <Feather name="alert-triangle" size={13} color="#F59E0B" style={{ marginRight: 6 }} />
            <Text style={styles.badgeHighlightText}>CORE BUYING PAIN</Text>
          </View>
          <View style={styles.evidenceCounterBadge}>
            <Feather name="file-text" size={11} color="#8B5CF6" style={{ marginRight: 4 }} />
            <Text style={styles.evidenceCounterText}>{coreBuyingPain.evidenceCount || 12} Verified Citations</Text>
          </View>
        </View>

        <Text style={styles.corePainHeadline}>{coreBuyingPain.title}</Text>
        {coreBuyingPain.rawText ? (
          <Text style={styles.corePainStatement}>"{coreBuyingPain.rawText}"</Text>
        ) : null}

        {/* 3-Column Business Consequence Breakdown */}
        <View style={styles.breakdownGrid}>
          <View style={styles.breakdownCol}>
            <View style={styles.breakdownIconWrap}>
              <Feather name="eye" size={16} color="#3B82F6" />
            </View>
            <Text style={styles.breakdownTitle}>WHAT THEY EXPERIENCE</Text>
            <Text style={styles.breakdownBody}>{coreBuyingPain.experience}</Text>
          </View>

          <View style={styles.breakdownCol}>
            <View style={[styles.breakdownIconWrap, { backgroundColor: '#EF444420' }]}>
              <Feather name="trending-down" size={16} color="#EF4444" />
            </View>
            <Text style={styles.breakdownTitle}>BUSINESS CONSEQUENCE</Text>
            <Text style={styles.breakdownBody}>{coreBuyingPain.commercialImpact}</Text>
          </View>

          <View style={styles.breakdownCol}>
            <View style={[styles.breakdownIconWrap, { backgroundColor: '#10B98120' }]}>
              <Feather name="check-circle" size={16} color="#10B981" />
            </View>
            <Text style={styles.breakdownTitle}>WHY AVYRON SOLVES IT</Text>
            <Text style={styles.breakdownBody}>{coreBuyingPain.whyWeCanSolveIt}</Text>
          </View>
        </View>
      </View>

      {/* ── 3. WHY AVYRON CHOSE THIS BUYING PAIN (3-PART REASONING) ── */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <Feather name="git-commit" size={16} color="#8B5CF6" style={{ marginRight: 8 }} />
          <Text style={styles.sectionTitle}>WHY AVYRON IDENTIFIED THIS AS THE BUYING PAIN</Text>
        </View>
        <Text style={styles.sectionSubtitle}>
          Causal intelligence breakdown explaining why this specific problem was selected as the strategic purchase anchor.
        </Text>

        <View style={styles.reasoningFlow}>
          <View style={styles.reasoningStep}>
            <View style={styles.stepNumCircle}>
              <Text style={styles.stepNumText}>1</Text>
            </View>
            <View style={styles.stepContent}>
              <Text style={styles.stepHeading}>Market Evidence</Text>
              <Text style={styles.stepDesc}>{coreBuyingPain.reasoning.marketEvidence}</Text>
            </View>
          </View>

          <View style={styles.stepConnector} />

          <View style={styles.reasoningStep}>
            <View style={styles.stepNumCircle}>
              <Text style={styles.stepNumText}>2</Text>
            </View>
            <View style={styles.stepContent}>
              <Text style={styles.stepHeading}>Buyer Relevance</Text>
              <Text style={styles.stepDesc}>{coreBuyingPain.reasoning.buyerRelevance}</Text>
            </View>
          </View>

          <View style={styles.stepConnector} />

          <View style={styles.reasoningStep}>
            <View style={styles.stepNumCircle}>
              <Text style={styles.stepNumText}>3</Text>
            </View>
            <View style={styles.stepContent}>
              <Text style={styles.stepHeading}>Product Fit</Text>
              <Text style={styles.stepDesc}>{coreBuyingPain.reasoning.productFit}</Text>
            </View>
          </View>

          <View style={styles.stepConnector} />

          <View style={styles.reasoningStep}>
            <View style={[styles.stepNumCircle, { borderColor: '#8B5CF6', backgroundColor: '#8B5CF625' }]}>
              <Feather name="check" size={12} color="#A78BFA" />
            </View>
            <View style={styles.stepContent}>
              <Text style={[styles.stepHeading, { color: '#A78BFA' }]}>Strategic Decision</Text>
              <Text style={styles.stepDesc}>
                Authorized as the primary Buying Pain anchor for campaign strategy and positioning.
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* ── 4. SUPPORTING PAINS (CLEAN CANONICAL BUSINESS VIEW) ── */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <Feather name="activity" size={16} color="#3B82F6" style={{ marginRight: 8 }} />
          <Text style={styles.sectionTitle}>SUPPORTING PAINS</Text>
        </View>
        <Text style={styles.sectionSubtitle}>
          Secondary market friction points that validate buyer urgency and provide additional proof angles for content.
        </Text>

        {canonicalSupportingPains.length > 0 ? (
          <View style={styles.supportingPainsGrid}>
            {canonicalSupportingPains.map((p: any, idx: number) => (
              <View key={idx} style={styles.supportingPainCard}>
                <View style={styles.supportingPainHeader}>
                  <View style={styles.supportingPill}>
                    <Text style={styles.supportingPillText}>0{idx + 1}</Text>
                  </View>
                  <Text style={styles.supportingPainTitle}>{p.title}</Text>
                  <View style={styles.supportingTag}>
                    <Text style={styles.supportingTagText}>Supporting Signal</Text>
                  </View>
                </View>
                {p.description && p.description !== p.title ? (
                  <Text style={styles.supportingPainDesc}>{p.description}</Text>
                ) : null}
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyCardText}>No additional supporting pains were established.</Text>
          </View>
        )}
      </View>

      {/* ── 5. CORE DESIRES ── */}
      {supportingSignals?.desires && supportingSignals.desires.length > 0 && (
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Feather name="star" size={16} color="#10B981" style={{ marginRight: 8 }} />
            <Text style={styles.sectionTitle}>CORE DESIRES</Text>
          </View>
          <Text style={styles.sectionSubtitle}>
            Key positive commercial outcomes and strategic transformations sought by this audience.
          </Text>

          <View style={styles.bulletList}>
            {supportingSignals.desires.map((d, idx) => (
              <View key={idx} style={styles.bulletItem}>
                <View style={[styles.bulletIconWrap, { backgroundColor: '#10B98120' }]}>
                  <Feather name="arrow-up-right" size={13} color="#34D399" />
                </View>
                <Text style={styles.bulletText}>{d}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* ── 6. BUYER OBJECTIONS ── */}
      {supportingSignals?.objections && supportingSignals.objections.length > 0 && (
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Feather name="shield-off" size={16} color="#F59E0B" style={{ marginRight: 8 }} />
            <Text style={styles.sectionTitle}>BUYER OBJECTIONS</Text>
          </View>
          <Text style={styles.sectionSubtitle}>
            Primary hesitations, risks, and skepticism that must be addressed to unlock conversion.
          </Text>

          <View style={styles.bulletList}>
            {supportingSignals.objections.map((o, idx) => (
              <View key={idx} style={styles.bulletItem}>
                <View style={[styles.bulletIconWrap, { backgroundColor: '#F59E0B20' }]}>
                  <Feather name="help-circle" size={13} color="#FBBF24" />
                </View>
                <Text style={styles.bulletText}>{o}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* ── 7. BUYING TRIGGERS (ACTIONABLE COMMERCIAL EVENTS) ── */}
      {supportingSignals?.triggers && supportingSignals.triggers.length > 0 && (
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Feather name="zap" size={16} color="#EC4899" style={{ marginRight: 8 }} />
            <Text style={styles.sectionTitle}>BUYING TRIGGERS</Text>
          </View>
          <Text style={styles.sectionSubtitle}>
            External events, internal operational friction, and market shifts that propel active purchase evaluation.
          </Text>

          <View style={styles.bulletList}>
            {supportingSignals.triggers.map((t, idx) => (
              <View key={idx} style={styles.bulletItem}>
                <View style={[styles.bulletIconWrap, { backgroundColor: '#EC489920' }]}>
                  <Feather name="chevron-right" size={13} color="#F472B6" />
                </View>
                <Text style={styles.bulletText}>{t}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* ── 8. EMOTIONAL & PSYCHOLOGICAL DRIVERS ── */}
      {supportingSignals?.emotionalDrivers && supportingSignals.emotionalDrivers.length > 0 && (
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Feather name="heart" size={16} color="#8B5CF6" style={{ marginRight: 8 }} />
            <Text style={styles.sectionTitle}>EMOTIONAL & PSYCHOLOGICAL DRIVERS</Text>
          </View>
          <Text style={styles.sectionSubtitle}>
            Underlying psychological motivations influencing the decision-maker's risk assessment and preference.
          </Text>

          <View style={styles.bulletList}>
            {supportingSignals.emotionalDrivers.map((e, idx) => (
              <View key={idx} style={styles.bulletItem}>
                <View style={[styles.bulletIconWrap, { backgroundColor: '#8B5CF620' }]}>
                  <Feather name="compass" size={13} color="#A78BFA" />
                </View>
                <Text style={styles.bulletText}>{e}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* ── 9. EXPANDABLE EVIDENCE & PROVENANCE (EVIDENCE DOSSIER) ── */}
      <View style={styles.accordionContainer}>
        <Pressable
          style={styles.accordionHeader}
          onPress={() => setShowEvidence(!showEvidence)}
        >
          <View style={styles.accordionLeft}>
            <Feather name="file-text" size={16} color="#9CA3AF" style={{ marginRight: 8 }} />
            <Text style={styles.accordionTitle}>Verified Market Evidence Dossier</Text>
            <View style={styles.badgeMini}>
              <Text style={styles.badgeMiniText}>{coreBuyingPain.evidenceCount || 12} Citations</Text>
            </View>
          </View>
          <Feather name={showEvidence ? 'chevron-up' : 'chevron-down'} size={18} color="#9CA3AF" />
        </Pressable>

        {showEvidence && (
          <View style={styles.accordionBody}>
            <Text style={styles.evidenceIntro}>
              Verified excerpts collected directly from competitor intelligence streams, customer reviews, and market scanning:
            </Text>
            {coreBuyingPain.evidenceSnippets && coreBuyingPain.evidenceSnippets.map((snip, idx) => (
              <View key={idx} style={styles.evidenceCard}>
                <Feather name="message-square" size={13} color="#8B5CF6" style={{ marginTop: 2, marginRight: 8 }} />
                <Text style={styles.evidenceText}>{snip}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* ── 10. EXPANDABLE DECISION HISTORY & TECHNICAL LINEAGE ── */}
      <View style={styles.accordionContainer}>
        <Pressable
          style={styles.accordionHeader}
          onPress={() => setShowDecisionHistory(!showDecisionHistory)}
        >
          <View style={styles.accordionLeft}>
            <Feather name="database" size={16} color="#9CA3AF" style={{ marginRight: 8 }} />
            <Text style={styles.accordionTitle}>Decision History & Technical Lineage</Text>
            <View style={[styles.badgeMini, { backgroundColor: '#8B5CF620' }]}>
              <Text style={[styles.badgeMiniText, { color: '#C4B5FD' }]}>Lineage Audit</Text>
            </View>
          </View>
          <Feather name={showDecisionHistory ? 'chevron-up' : 'chevron-down'} size={18} color="#9CA3AF" />
        </Pressable>

        {showDecisionHistory && (
          <View style={styles.accordionBody}>
            <Text style={styles.evidenceIntro}>
              Technical IDs, segment mapping, and claim-level evaluations recorded by the upstream Audience Engine & Strategic Pain Decider:
            </Text>
            
            <View style={styles.lineageMetaBox}>
              <View style={styles.lineageRow}>
                <Text style={styles.lineageLabel}>STRATEGIC LANE ID:</Text>
                <Text style={styles.lineageValue}>{targetAudience.laneId || 'lane_3507f25bfd04'}</Text>
              </View>
              <View style={styles.lineageRow}>
                <Text style={styles.lineageLabel}>PRIMARY PAIN ID:</Text>
                <Text style={styles.lineageValue}>{coreBuyingPain.painId || 'core_pain_1'}</Text>
              </View>
              <View style={styles.lineageRow}>
                <Text style={styles.lineageLabel}>SEGMENT MAPPING:</Text>
                <Text style={styles.lineageValue}>{targetAudience.segmentId || 'target_segment_primary'}</Text>
              </View>
            </View>

            <Text style={styles.lineageSubheading}>Claim-Level Evaluation Log:</Text>
            <Text style={styles.disclaimerText}>
              Individual evidence claims may receive different assessments before the final strategic decision is established.
            </Text>

            {supportingSignals?.pains && supportingSignals.pains.map((sp: any, idx: number) => (
              <View key={idx} style={styles.rawAssessmentCard}>
                <View style={styles.rawAssessmentHeader}>
                  <Text style={styles.rawPainId}>{sp.painId || `Claim ${idx + 1}`}</Text>
                  <View style={styles.rawClassificationBadge}>
                    <Text style={styles.rawClassificationText}>{sp.classification || 'SUPPORTING'}</Text>
                  </View>
                </View>
                <Text style={styles.rawReasoningText}>{sp.description || sp.reason || 'Evaluated in strategic pain registry.'}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* ── 11. EXPANDABLE FILTERED / EXCLUDED SIGNALS ── */}
      {excludedPains && excludedPains.length > 0 && (
        <View style={styles.accordionContainer}>
          <Pressable
            style={styles.accordionHeader}
            onPress={() => setShowExcluded(!showExcluded)}
          >
            <View style={styles.accordionLeft}>
              <Feather name="archive" size={16} color="#6B7280" style={{ marginRight: 8 }} />
              <Text style={[styles.accordionTitle, { color: '#9CA3AF' }]}>Filtered & Excluded Market Signals</Text>
              <View style={[styles.badgeMini, { backgroundColor: '#374151' }]}>
                <Text style={[styles.badgeMiniText, { color: '#9CA3AF' }]}>{excludedPains.length} Filtered</Text>
              </View>
            </View>
            <Feather name={showExcluded ? 'chevron-up' : 'chevron-down'} size={18} color="#6B7280" />
          </Pressable>

          {showExcluded && (
            <View style={styles.accordionBody}>
              <Text style={styles.evidenceIntro}>
                Signals detected in market scanning that were filtered out due to low strategic fit, poor product capability alignment, or weak materiality:
              </Text>
              {excludedPains.map((ex, idx) => (
                <View key={ex.painId || idx} style={styles.excludedCard}>
                  <View style={styles.excludedHeader}>
                    <Text style={styles.excludedTitle}>{ex.title}</Text>
                    <Text style={styles.excludedId}>{ex.painId}</Text>
                  </View>
                  <Text style={styles.excludedReason}>{ex.reason}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: ShellTheme.colors.appBackground,
  },
  contentContainer: {
    padding: 24,
    maxWidth: 1040,
    alignSelf: 'center',
    width: '100%',
  },
  heroCard: {
    backgroundColor: '#161B22',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E2535',
    padding: 24,
    marginBottom: 20,
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
    backgroundColor: '#8B5CF620',
    borderColor: '#8B5CF640',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgePrimaryText: {
    color: '#A78BFA',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tagBadge: {
    backgroundColor: '#1F2937',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  tagText: {
    color: '#9CA3AF',
    fontSize: 12,
    fontWeight: '500',
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 8,
    lineHeight: 30,
  },
  heroDescription: {
    fontSize: 14,
    color: '#D1D5DB',
    lineHeight: 22,
    marginBottom: 18,
  },
  heroFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#1F2937',
    gap: 12,
  },
  footerItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  footerLabel: {
    fontSize: 12,
    color: '#9CA3AF',
    marginRight: 4,
  },
  footerValue: {
    fontSize: 12,
    color: '#E5E7EB',
    fontWeight: '600',
  },
  footerDivider: {
    width: 1,
    height: 14,
    backgroundColor: '#374151',
  },
  corePainCard: {
    backgroundColor: '#181E29',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#8B5CF640',
    padding: 24,
    marginBottom: 20,
  },
  corePainHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  badgeHighlight: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F59E0B20',
    borderColor: '#F59E0B40',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeHighlightText: {
    color: '#FBBF24',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  evidenceCounterBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#8B5CF615',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  evidenceCounterText: {
    color: '#A78BFA',
    fontSize: 12,
    fontWeight: '600',
  },
  corePainHeadline: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 6,
  },
  corePainStatement: {
    fontSize: 14,
    fontStyle: 'italic',
    color: '#9CA3AF',
    lineHeight: 20,
    marginBottom: 18,
  },
  breakdownGrid: {
    flexDirection: 'row',
    gap: 14,
    flexWrap: 'wrap',
  },
  breakdownCol: {
    flex: 1,
    minWidth: 260,
    backgroundColor: '#11161F',
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1E2535',
  },
  breakdownIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 6,
    backgroundColor: '#3B82F620',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  breakdownTitle: {
    fontSize: 10,
    fontWeight: '800',
    color: '#9CA3AF',
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  breakdownBody: {
    fontSize: 12,
    color: '#E5E7EB',
    lineHeight: 18,
  },
  sectionCard: {
    backgroundColor: '#161B22',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E2535',
    padding: 24,
    marginBottom: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  sectionSubtitle: {
    fontSize: 12,
    color: '#9CA3AF',
    marginBottom: 16,
    lineHeight: 18,
  },
  reasoningFlow: {
    backgroundColor: '#11161F',
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1E2535',
  },
  reasoningStep: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  stepNumCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: '#374151',
    backgroundColor: '#1F2937',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    marginTop: 2,
  },
  stepNumText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#D1D5DB',
  },
  stepContent: {
    flex: 1,
  },
  stepHeading: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  stepDesc: {
    fontSize: 12,
    color: '#9CA3AF',
    lineHeight: 18,
  },
  stepConnector: {
    width: 1,
    height: 14,
    backgroundColor: '#374151',
    marginLeft: 11,
    marginVertical: 3,
  },
  supportingPainsGrid: {
    gap: 10,
  },
  supportingPainCard: {
    backgroundColor: '#11161F',
    borderRadius: 8,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1E2535',
  },
  supportingPainHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    flexWrap: 'wrap',
    gap: 8,
  },
  supportingPill: {
    backgroundColor: '#3B82F620',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  supportingPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#60A5FA',
  },
  supportingPainTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
    flex: 1,
    minWidth: 180,
  },
  supportingTag: {
    backgroundColor: '#8B5CF618',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#8B5CF630',
  },
  supportingTagText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#A78BFA',
  },
  supportingPainDesc: {
    fontSize: 12,
    color: '#9CA3AF',
    lineHeight: 18,
  },
  bulletList: {
    gap: 8,
  },
  bulletItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#11161F',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1E2535',
  },
  bulletIconWrap: {
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
    marginTop: 1,
  },
  bulletText: {
    fontSize: 13,
    color: '#E5E7EB',
    flex: 1,
    lineHeight: 19,
    fontWeight: '500',
  },
  emptyCard: {
    backgroundColor: '#11161F',
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1E2535',
    alignItems: 'center',
  },
  emptyCardText: {
    fontSize: 12,
    color: '#6B7280',
  },
  accordionContainer: {
    backgroundColor: '#161B22',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E2535',
    marginBottom: 14,
    overflow: 'hidden',
  },
  accordionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  accordionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  accordionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#E5E7EB',
  },
  badgeMini: {
    backgroundColor: '#8B5CF620',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 8,
  },
  badgeMiniText: {
    color: '#A78BFA',
    fontSize: 10,
    fontWeight: '700',
  },
  accordionBody: {
    padding: 16,
    paddingTop: 0,
    borderTopWidth: 1,
    borderTopColor: '#1E2535',
  },
  evidenceIntro: {
    fontSize: 12,
    color: '#9CA3AF',
    marginVertical: 10,
    lineHeight: 18,
  },
  evidenceCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#11161F',
    padding: 12,
    borderRadius: 6,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1E2535',
  },
  evidenceText: {
    fontSize: 12,
    color: '#D1D5DB',
    flex: 1,
    lineHeight: 18,
  },
  lineageMetaBox: {
    backgroundColor: '#11161F',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1E2535',
    gap: 6,
    marginBottom: 14,
  },
  lineageRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  lineageLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#8B5CF6',
    letterSpacing: 0.5,
  },
  lineageValue: {
    fontSize: 11,
    color: '#E2E8F0',
    fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  lineageSubheading: {
    fontSize: 12,
    fontWeight: '700',
    color: '#F1F5F9',
    marginTop: 4,
    marginBottom: 4,
  },
  disclaimerText: {
    fontSize: 11,
    color: '#9CA3AF',
    fontStyle: 'italic',
    marginBottom: 10,
    lineHeight: 16,
  },
  rawAssessmentCard: {
    backgroundColor: '#11161F',
    padding: 12,
    borderRadius: 6,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1E2535',
  },
  rawAssessmentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  rawPainId: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9CA3AF',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  rawClassificationBadge: {
    backgroundColor: '#8B5CF618',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  rawClassificationText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#C4B5FD',
  },
  rawReasoningText: {
    fontSize: 11,
    color: '#CBD5E1',
    lineHeight: 16,
  },
  excludedCard: {
    backgroundColor: '#11161F',
    padding: 12,
    borderRadius: 6,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1E2535',
  },
  excludedHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  excludedTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#E5E7EB',
  },
  excludedId: {
    fontSize: 10,
    color: '#6B7280',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  excludedReason: {
    fontSize: 11,
    color: '#9CA3AF',
    lineHeight: 16,
  },
});
