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
import { useRouter } from 'expo-router';
import { ShellTheme } from '@/constants/ShellTheme';
import type { AudiencePositioningViewModel } from '@/types/audience-positioning';

interface Props {
  data: AudiencePositioningViewModel;
}

export default function AudienceIntelligenceView({ data }: Props) {
  const router = useRouter();
  const [showEvidence, setShowEvidence] = useState(false);
  const [showDecisionHistory, setShowDecisionHistory] = useState(false);
  const [showExcluded, setShowExcluded] = useState(false);

  const { targetAudience, coreBuyingPain, supportingSignals, excludedPains, commercialAudienceSynthesis } = data;

  if (data.hasAudience === false && !targetAudience?.title) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false}>
        <View style={styles.emptyStateCard}>
          <Feather name="users" size={32} color="#6B7280" style={{ marginBottom: 12 }} />
          <Text style={styles.emptyStateTitle}>No Audience Intelligence Generated</Text>
          <Text style={styles.emptyStateSubtitle}>
            No Audience Intelligence has been generated for this campaign yet. Run the Audience engine to discover target segments, buying pains, and customer motivations.
          </Text>
          <Pressable
            style={{ marginTop: 16, backgroundColor: '#8B5CF6', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 6 }}
            onPress={() => router.push('/(tabs)/strategy-plan')}
          >
            <Feather name="zap" size={14} color="#FFFFFF" />
            <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '700' }}>Open Strategy Plan</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

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
          {targetAudience.marketType ? (
            <View style={styles.metaRow}>
              <View style={styles.tagBadge}>
                <Text style={styles.tagText}>{targetAudience.marketType}</Text>
              </View>
            </View>
          ) : null}
        </View>

        <Text style={styles.heroTitle}>{targetAudience.title || 'Target Audience'}</Text>
        {targetAudience.description ? (
          <Text style={styles.heroDescription}>{targetAudience.description}</Text>
        ) : null}

        <View style={styles.heroFooter}>
          <View style={styles.footerItem}>
            <Feather name="briefcase" size={14} color="#9CA3AF" style={{ marginRight: 6 }} />
            <Text style={styles.footerLabel}>Buyer Role:</Text>
            <Text style={styles.footerValue}>{targetAudience.buyerRole || 'Target Customer'}</Text>
          </View>
          {targetAudience.commercialRelevance ? (
            <>
              <View style={styles.footerDivider} />
              <View style={styles.footerItem}>
                <Feather name="compass" size={14} color="#9CA3AF" style={{ marginRight: 6 }} />
                <Text style={styles.footerLabel}>Strategic Context:</Text>
                <Text style={styles.footerValue}>{targetAudience.commercialRelevance}</Text>
              </View>
            </>
          ) : null}
        </View>
      </View>

      {/* ── 1B. SELECTED OFFERING & COMMERCIAL SCOPE ── */}
      {commercialAudienceSynthesis?.selectedOfferingName || commercialAudienceSynthesis?.selectedVariantName ? (
        <View style={styles.offeringScopeCard}>
          <View style={styles.offeringScopeHeader}>
            <View style={styles.offeringScopeBadge}>
              <Feather name="package" size={12} color="#10B981" style={{ marginRight: 5 }} />
              <Text style={styles.offeringScopeBadgeText}>SELECTED OFFERING SCOPE</Text>
            </View>
            {commercialAudienceSynthesis.packageOrScopeSuitability?.suitabilityVerdict ? (
              <View style={[styles.suitabilityBadge, {
                backgroundColor: commercialAudienceSynthesis.packageOrScopeSuitability.suitabilityVerdict === 'SUITABLE' ? '#10B98120' : '#F59E0B20',
                borderColor: commercialAudienceSynthesis.packageOrScopeSuitability.suitabilityVerdict === 'SUITABLE' ? '#10B98140' : '#F59E0B40',
              }]}>
                <Text style={[styles.suitabilityBadgeText, {
                  color: commercialAudienceSynthesis.packageOrScopeSuitability.suitabilityVerdict === 'SUITABLE' ? '#34D399' : '#FBBF24',
                }]}>
                  {commercialAudienceSynthesis.packageOrScopeSuitability.suitabilityVerdict}
                </Text>
              </View>
            ) : null}
          </View>

          <Text style={styles.offeringScopeTitle}>
            {commercialAudienceSynthesis.selectedOfferingName || 'Selected Offering'}
            {commercialAudienceSynthesis.selectedVariantName ? ` · ${commercialAudienceSynthesis.selectedVariantName}` : ''}
          </Text>

          <View style={styles.offeringDetailsRow}>
            {commercialAudienceSynthesis.selectedVariantScope ? (
              <View style={styles.offeringDetailItem}>
                <Feather name="layers" size={13} color="#9CA3AF" style={{ marginRight: 5 }} />
                <Text style={styles.offeringDetailLabel}>Scope:</Text>
                <Text style={styles.offeringDetailValue}>{commercialAudienceSynthesis.selectedVariantScope}</Text>
              </View>
            ) : null}
            {commercialAudienceSynthesis.selectedVariantPricing?.amount != null ? (
              <View style={styles.offeringDetailItem}>
                <Feather name="tag" size={13} color="#9CA3AF" style={{ marginRight: 5 }} />
                <Text style={styles.offeringDetailLabel}>Price:</Text>
                <Text style={styles.offeringDetailValue}>
                  {commercialAudienceSynthesis.selectedVariantPricing.currency || '$'}
                  {commercialAudienceSynthesis.selectedVariantPricing.amount}
                </Text>
              </View>
            ) : null}
          </View>

          {commercialAudienceSynthesis.packageOrScopeSuitability?.notes ? (
            <Text style={styles.suitabilityNotes}>
              {commercialAudienceSynthesis.packageOrScopeSuitability.notes}
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* ── 2. CORE BUYING PAIN (DOMINANT PRIMARY DECISION) ── */}

      <View style={styles.corePainCard}>
        <View style={styles.corePainHeader}>
          <View style={styles.badgeHighlight}>
            <Feather name="alert-triangle" size={13} color="#F59E0B" style={{ marginRight: 6 }} />
            <Text style={styles.badgeHighlightText}>CORE BUYING PAIN</Text>
          </View>
          <View style={styles.evidenceCounterBadge}>
            <Feather name="file-text" size={11} color="#8B5CF6" style={{ marginRight: 4 }} />
            <Text style={styles.evidenceCounterText}>{coreBuyingPain.evidenceCount ?? 0} Verified Citations</Text>
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
            <Text style={styles.breakdownTitle}>WHY {((data as any).businessName || 'THIS SOLUTION').toUpperCase()} SOLVES IT</Text>
            <Text style={styles.breakdownBody}>{coreBuyingPain.whyWeCanSolveIt}</Text>
          </View>
        </View>
      </View>

      {/* ── 3. WHY THIS BUYING PAIN WAS CHOSEN (3-PART REASONING) ── */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <Feather name="git-commit" size={16} color="#8B5CF6" style={{ marginRight: 8 }} />
          <Text style={styles.sectionTitle}>WHY THIS WAS IDENTIFIED AS THE CORE BUYING PAIN</Text>
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
                {coreBuyingPain.reasoning.strategicDecision || 'Selected as the primary Buying Pain anchor for campaign strategy and positioning.'}
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

      {/* ── 8B. COMMERCIAL INTELLIGENCE & AUDIENCE FIT SYNTHESIS ── */}
      {commercialAudienceSynthesis ? (
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Feather name="bar-chart-2" size={16} color="#8B5CF6" style={{ marginRight: 8 }} />
            <Text style={styles.sectionTitle}>COMMERCIAL EVIDENCE & AUDIENCE SYNTHESIS</Text>
          </View>
          <Text style={styles.sectionSubtitle}>
            Commercial competitor comparisons, customer experience sentiment, offering-to-need fit, and validated boundaries.
          </Text>

          {/* Sentiment Polarity Badges */}
          <View style={styles.sentimentRow}>
            <View style={[styles.sentimentBadge, { backgroundColor: '#10B98118', borderColor: '#10B98135' }]}>
              <View style={[styles.sentimentDot, { backgroundColor: '#10B981' }]} />
              <Text style={[styles.sentimentText, { color: '#34D399' }]}>Positive Experience</Text>
            </View>
            <View style={[styles.sentimentBadge, { backgroundColor: '#EF444418', borderColor: '#EF444435' }]}>
              <View style={[styles.sentimentDot, { backgroundColor: '#EF4444' }]} />
              <Text style={[styles.sentimentText, { color: '#F87171' }]}>Negative Friction</Text>
            </View>
            <View style={[styles.sentimentBadge, { backgroundColor: '#F59E0B18', borderColor: '#F59E0B35' }]}>
              <View style={[styles.sentimentDot, { backgroundColor: '#F59E0B' }]} />
              <Text style={[styles.sentimentText, { color: '#FBBF24' }]}>Mixed Experience</Text>
            </View>
            <View style={[styles.sentimentBadge, { backgroundColor: '#3B82F618', borderColor: '#3B82F635' }]}>
              <View style={[styles.sentimentDot, { backgroundColor: '#3B82F6' }]} />
              <Text style={[styles.sentimentText, { color: '#60A5FA' }]}>Neutral Feedback</Text>
            </View>
            <View style={[styles.sentimentBadge, { backgroundColor: '#6B728018', borderColor: '#6B728035' }]}>
              <View style={[styles.sentimentDot, { backgroundColor: '#6B7280' }]} />
              <Text style={[styles.sentimentText, { color: '#9CA3AF' }]}>Unclassified</Text>
            </View>
          </View>

          {/* Review-Backed Competitor Strengths */}
          {commercialAudienceSynthesis.reviewBackedStrengths && commercialAudienceSynthesis.reviewBackedStrengths.length > 0 && (
            <View style={styles.synthSubSection}>
              <Text style={styles.synthSubTitle}>Review-Backed Competitor Strengths</Text>
              <View style={styles.strengthGrid}>
                {commercialAudienceSynthesis.reviewBackedStrengths.map((str, idx) => (
                  <View key={idx} style={styles.strengthCard}>
                    <View style={styles.strengthHeader}>
                      <Text style={styles.strengthCompetitor}>{str.competitorName}</Text>
                      {str.platform ? (
                        <View style={styles.platformBadge}>
                          <Text style={styles.platformBadgeText}>{str.platform}</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={styles.strengthText}>{str.strength}</Text>
                    {str.sampleReviewSnippet ? (
                      <Text style={styles.strengthSnippet}>"{str.sampleReviewSnippet}"</Text>
                    ) : null}
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Comparable Competitors */}
          {commercialAudienceSynthesis.comparableCompetitors && commercialAudienceSynthesis.comparableCompetitors.length > 0 && (
            <View style={styles.synthSubSection}>
              <Text style={styles.synthSubTitle}>Comparable Competitor Products & Pricing</Text>
              <View style={styles.competitorGrid}>
                {commercialAudienceSynthesis.comparableCompetitors.map((comp, idx) => (
                  <View key={idx} style={styles.competitorCard}>
                    <View style={styles.competitorCardHeader}>
                      <Text style={styles.competitorName}>{comp.competitorName}</Text>
                      {comp.pricingSummary ? (
                        <Text style={styles.competitorPricing}>{comp.pricingSummary}</Text>
                      ) : null}
                    </View>
                    {comp.productOrServiceName ? (
                      <Text style={styles.competitorProduct}>{comp.productOrServiceName}</Text>
                    ) : null}
                    {comp.evidenceUids && comp.evidenceUids.length > 0 && (
                      <Text style={styles.competitorEvidence}>
                        Citations: {comp.evidenceUids.join(', ')}
                      </Text>
                    )}
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Offering-to-Need Fit Breakdown */}
          {commercialAudienceSynthesis.offeringFitBreakdown && commercialAudienceSynthesis.offeringFitBreakdown.length > 0 && (
            <View style={styles.synthSubSection}>
              <Text style={styles.synthSubTitle}>Offering-to-Need Fit Breakdown</Text>
              {commercialAudienceSynthesis.offeringFitBreakdown.map((fit, idx) => (
                <View key={idx} style={styles.fitCard}>
                  <View style={styles.fitHeader}>
                    <Text style={styles.fitNeedText}>{fit.need}</Text>
                    <View style={[styles.fitBadge, {
                      backgroundColor: fit.fitType === 'DIRECT_FIT' ? '#10B98120' : '#F59E0B20',
                      borderColor: fit.fitType === 'DIRECT_FIT' ? '#10B98140' : '#F59E0B40',
                    }]}>
                      <Text style={[styles.fitBadgeText, {
                        color: fit.fitType === 'DIRECT_FIT' ? '#34D399' : '#FBBF24',
                      }]}>
                        {fit.fitType}
                      </Text>
                    </View>
                  </View>

                  {fit.provenClauses && fit.provenClauses.length > 0 && (
                    <View style={styles.clauseList}>
                      {fit.provenClauses.map((clause, cIdx) => (
                        <View key={cIdx} style={styles.clauseItem}>
                          <Feather name="check" size={12} color="#10B981" style={{ marginRight: 6 }} />
                          <Text style={styles.clauseText}>Proven: {clause}</Text>
                        </View>
                      ))}
                    </View>
                  )}

                  {fit.unresolvedRequirements && fit.unresolvedRequirements.length > 0 && (
                    <View style={styles.unresolvedList}>
                      {fit.unresolvedRequirements.map((unres, uIdx) => (
                        <View key={uIdx} style={styles.unresolvedItem}>
                          <Feather name="alert-circle" size={12} color="#F59E0B" style={{ marginRight: 6 }} />
                          <Text style={styles.unresolvedItemText}>Unresolved Requirement: {unres}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              ))}
            </View>
          )}

          {/* Price / Value Limitations */}
          {commercialAudienceSynthesis.priceValueLimitations && commercialAudienceSynthesis.priceValueLimitations.length > 0 && (
            <View style={styles.synthSubSection}>
              <Text style={styles.synthSubTitle}>Price & Value Comparability Limitations</Text>
              {commercialAudienceSynthesis.priceValueLimitations.map((lim, idx) => (
                <View key={idx} style={styles.limitationCard}>
                  <Text style={styles.limitationDim}>{lim.dimension}</Text>
                  <Text style={styles.limitationDesc}>{lim.limitation}</Text>
                  {lim.unknownFactor ? (
                    <Text style={styles.limitationUnknown}>Unknown: {lim.unknownFactor}</Text>
                  ) : null}
                </View>
              ))}
            </View>
          )}

          {/* Proposed Capabilities & Prerequisites */}
          {commercialAudienceSynthesis.proposedCapabilities && commercialAudienceSynthesis.proposedCapabilities.length > 0 && (
            <View style={styles.synthSubSection}>
              <Text style={styles.synthSubTitle}>Proposed Capabilities & Prerequisites</Text>
              {commercialAudienceSynthesis.proposedCapabilities.map((prop, idx) => (
                <View key={idx} style={styles.proposedCard}>
                  <View style={styles.proposedHeader}>
                    <Text style={styles.proposedTitle}>{prop.capability}</Text>
                    <View style={[styles.propBadge, {
                      backgroundColor: prop.status === 'VALIDATED' ? '#10B98120' : '#F59E0B20',
                      borderColor: prop.status === 'VALIDATED' ? '#10B98140' : '#F59E0B40',
                    }]}>
                      <Text style={[styles.propBadgeText, {
                        color: prop.status === 'VALIDATED' ? '#34D399' : '#FBBF24',
                      }]}>
                        {prop.status}
                      </Text>
                    </View>
                  </View>
                  {prop.prerequisites && prop.prerequisites.length > 0 && (
                    <View style={styles.prereqList}>
                      {prop.prerequisites.map((req, rIdx) => (
                        <Text key={rIdx} style={styles.prereqText}>• Prerequisite: {req}</Text>
                      ))}
                    </View>
                  )}
                </View>
              ))}
            </View>
          )}
        </View>
      ) : null}

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
              <Text style={styles.badgeMiniText}>{coreBuyingPain.evidenceCount ?? 0} Citations</Text>
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
                <Text style={styles.lineageValue}>{targetAudience.laneId || 'N/A'}</Text>
              </View>
              <View style={styles.lineageRow}>
                <Text style={styles.lineageLabel}>PRIMARY PAIN ID:</Text>
                <Text style={styles.lineageValue}>{coreBuyingPain.painId || 'N/A'}</Text>
              </View>
              <View style={styles.lineageRow}>
                <Text style={styles.lineageLabel}>SEGMENT MAPPING:</Text>
                <Text style={styles.lineageValue}>{targetAudience.segmentId || 'N/A'}</Text>
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
  emptyStateCard: {
    backgroundColor: '#161B22',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E2535',
    padding: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
  },
  emptyStateTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  emptyStateSubtitle: {
    fontSize: 13,
    color: '#9CA3AF',
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 480,
  },
  offeringScopeCard: {
    backgroundColor: '#0F172A',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1E293B',
    padding: 16,
    marginBottom: 16,
  },
  offeringScopeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  offeringScopeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#10B98115',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#10B98130',
  },
  offeringScopeBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#34D399',
    letterSpacing: 0.6,
  },
  suitabilityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  suitabilityBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  offeringScopeTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#F8FAFC',
    marginBottom: 8,
  },
  offeringDetailsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 8,
  },
  offeringDetailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B60',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  offeringDetailLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
    marginRight: 4,
  },
  offeringDetailValue: {
    fontSize: 11,
    fontWeight: '600',
    color: '#E2E8F0',
  },
  suitabilityNotes: {
    fontSize: 11,
    color: '#94A3B8',
    lineHeight: 16,
    fontStyle: 'italic',
  },
  sentimentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  sentimentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  sentimentDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  sentimentText: {
    fontSize: 10,
    fontWeight: '700',
  },
  synthSubSection: {
    marginTop: 14,
    marginBottom: 8,
  },
  synthSubTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#C4B5FD',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  strengthGrid: {
    gap: 8,
  },
  strengthCard: {
    backgroundColor: '#11161F',
    borderWidth: 1,
    borderColor: '#1E2535',
    borderRadius: 8,
    padding: 12,
  },
  strengthHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  strengthCompetitor: {
    fontSize: 12,
    fontWeight: '700',
    color: '#E2E8F0',
  },
  platformBadge: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  platformBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#94A3B8',
  },
  strengthText: {
    fontSize: 11,
    color: '#34D399',
    fontWeight: '600',
    marginBottom: 4,
  },
  strengthSnippet: {
    fontSize: 11,
    color: '#94A3B8',
    fontStyle: 'italic',
    lineHeight: 16,
  },
  competitorGrid: {
    gap: 8,
  },
  competitorCard: {
    backgroundColor: '#11161F',
    borderWidth: 1,
    borderColor: '#1E2535',
    borderRadius: 8,
    padding: 12,
  },
  competitorCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  competitorName: {
    fontSize: 12,
    fontWeight: '700',
    color: '#F1F5F9',
  },
  competitorPricing: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FBBF24',
  },
  competitorProduct: {
    fontSize: 11,
    color: '#94A3B8',
    marginBottom: 4,
  },
  competitorEvidence: {
    fontSize: 10,
    color: '#64748B',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  fitCard: {
    backgroundColor: '#11161F',
    borderWidth: 1,
    borderColor: '#1E2535',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  fitHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  fitNeedText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#F8FAFC',
    flex: 1,
    marginRight: 8,
  },
  fitBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  fitBadgeText: {
    fontSize: 9,
    fontWeight: '800',
  },
  clauseList: {
    gap: 4,
    marginBottom: 6,
  },
  clauseItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  clauseText: {
    fontSize: 11,
    color: '#34D399',
    lineHeight: 16,
  },
  unresolvedList: {
    gap: 4,
  },
  unresolvedItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  unresolvedItemText: {
    fontSize: 11,
    color: '#FBBF24',
    lineHeight: 16,
  },
  limitationCard: {
    backgroundColor: '#11161F',
    borderWidth: 1,
    borderColor: '#1E2535',
    borderRadius: 8,
    padding: 10,
    marginBottom: 6,
  },
  limitationDim: {
    fontSize: 11,
    fontWeight: '700',
    color: '#E2E8F0',
    marginBottom: 2,
  },
  limitationDesc: {
    fontSize: 11,
    color: '#94A3B8',
    lineHeight: 16,
  },
  limitationUnknown: {
    fontSize: 10,
    color: '#F59E0B',
    fontStyle: 'italic',
    marginTop: 2,
  },
  proposedCard: {
    backgroundColor: '#11161F',
    borderWidth: 1,
    borderColor: '#1E2535',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  proposedHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  proposedTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#F1F5F9',
  },
  propBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
  },
  propBadgeText: {
    fontSize: 9,
    fontWeight: '800',
  },
  prereqList: {
    marginTop: 4,
    gap: 2,
  },
  prereqText: {
    fontSize: 11,
    color: '#FBBF24',
    lineHeight: 16,
  },
});

