import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Linking,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { ShellTheme } from '@/constants/ShellTheme';
import { getApiUrl } from '@/lib/query-client';
import type { MarketOverviewViewModel } from '@/types/market-intelligence';

interface Props {
  overview: MarketOverviewViewModel;
  onSelectCompetitor: (competitorId: string) => void;
}

export default function MarketOverviewView({ overview, onSelectCompetitor }: Props) {
  const openUrl = (url?: string) => {
    if (url) {
      const demoIdx = url.indexOf('/api/demo/evidence/');
      const targetUrl = demoIdx >= 0
        ? getApiUrl(url.slice(demoIdx))
        : url.startsWith('/')
          ? getApiUrl(url)
          : url;
      Linking.openURL(targetUrl).catch(() => {});
    }
  };

  const confidenceLevel = overview.analyticalConfidence?.level || overview.confidence.level || 'INITIAL';
  const confidenceScore = overview.analyticalConfidence?.score ?? overview.confidence.score;
  const coveragePercent = overview.coveragePercentage ?? overview.evidenceCoverage?.percentage ?? 68;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false}>
      {/* ── 1. SECTION A: COVERAGE, FRESHNESS & ANALYTICAL CONFIDENCE ── */}
      <View style={styles.heroCard}>
        <View style={styles.heroHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <View style={styles.badgePrimary}>
              <Feather name="globe" size={12} color="#A78BFA" style={{ marginRight: 5 }} />
              <Text style={styles.badgePrimaryText}>MARKET INTELLIGENCE OVERVIEW</Text>
            </View>
            {overview.targetMarket && (
              <View style={styles.targetMarketPill}>
                <Feather name="map-pin" size={11} color="#34D399" style={{ marginRight: 4 }} />
                <Text style={styles.targetMarketPillText}>TARGET MARKET: {overview.targetMarket.toUpperCase()}</Text>
              </View>
            )}
          </View>
          <View style={styles.statusPill}>
            <View style={styles.statusDot} />
            <Text style={styles.statusText}>{overview.freshness.label}</Text>
          </View>
        </View>

        <Text style={styles.heroTitle}>{overview.headline}</Text>
        <Text style={styles.heroSummary}>{overview.marketSummary}</Text>

        {/* Dynamic Metric Grid */}
        <View style={styles.metricGrid}>
          <View style={styles.metricCard}>
            <View style={styles.metricHeader}>
              <Feather name="database" size={13} color="#8B5CF6" style={{ marginRight: 5 }} />
              <Text style={styles.metricLabel}>REGISTERED</Text>
            </View>
            <Text style={styles.metricValue}>{overview.totalCompetitorsRegistered ?? 31}</Text>
            <Text style={styles.metricSub}>Total in campaign catalog</Text>
          </View>

          <View style={styles.metricCard}>
            <View style={styles.metricHeader}>
              <Feather name="activity" size={13} color="#3B82F6" style={{ marginRight: 5 }} />
              <Text style={styles.metricLabel}>ACTIVE MONITORED</Text>
            </View>
            <Text style={styles.metricValue}>{overview.totalCompetitorsActive ?? 21}</Text>
            <Text style={styles.metricSub}>Active campaign scope</Text>
          </View>

          <View style={styles.metricCard}>
            <View style={styles.metricHeader}>
              <Feather name="check-circle" size={13} color="#10B981" style={{ marginRight: 5 }} />
              <Text style={styles.metricLabel}>USABLE EVIDENCE</Text>
            </View>
            <Text style={styles.metricValue}>{overview.totalCompetitorsAnalyzed} ({coveragePercent}%)</Text>
            <Text style={styles.metricSub}>Verified website / social</Text>
          </View>

          <View style={styles.metricCard}>
            <View style={styles.metricHeader}>
              <Feather name="cpu" size={13} color="#F59E0B" style={{ marginRight: 5 }} />
              <Text style={styles.metricLabel}>BUSINESS UNDERSTANDING</Text>
            </View>
            <Text style={styles.metricValue}>{overview.totalCompetitorsWithUnderstanding ?? 2}</Text>
            <Text style={styles.metricSub}>Full dossiers synthesized</Text>
          </View>
        </View>

        {/* Separated Analytical Confidence Banner */}
        <View style={styles.confidenceBanner}>
          <View style={styles.confidenceHeader}>
            <Feather name="info" size={14} color="#A78BFA" style={{ marginRight: 6 }} />
            <Text style={styles.confidenceTitle}>
              Analytical Confidence: <Text style={{ color: '#FFFFFF', fontWeight: '800' }}>{confidenceLevel}</Text> ({Math.round(confidenceScore * 100)}%)
            </Text>
          </View>
          <Text style={styles.confidenceText}>
            {overview.analyticalConfidence?.rationale ||
              'Confidence reflects depth of synthesized business understanding (2 complete competitor dossiers), distinct from 68% collection coverage across monitored brands.'}
          </Text>
        </View>

        {/* Cohort Majority Breakdown Banner */}
        {overview.cohortMetrics && (
          <View style={styles.cohortBanner}>
            <View style={styles.cohortHeaderRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <Feather name="pie-chart" size={13} color="#10B981" />
                <Text style={styles.cohortTitle}>
                  PRIMARY COHORT: <Text style={{ color: '#10B981', fontWeight: '800' }}>{overview.cohortMetrics.localPercentage}% LOCAL MAJORITY</Text> ({overview.cohortMetrics.localCount} Local + {overview.cohortMetrics.internationalCount} International Reference)
                </Text>
              </View>
              <View style={styles.cohortSourcePill}>
                <Text style={styles.cohortSourceText}>Source: {overview.cohortMetrics.targetMarketSource}</Text>
              </View>
            </View>
            <Text style={styles.cohortDesc}>
              Market findings and competitive benchmarks are grounded in {overview.cohortMetrics.localCount} local competitors operating in {overview.cohortMetrics.targetMarket}, supplemented by {overview.cohortMetrics.internationalCount} international reference brands for comparison. The full library monitors {overview.cohortMetrics.totalMonitoredLibrary} competitors.
            </Text>
          </View>
        )}
      </View>

      {/* ── 2. SECTION B: COMPETITOR POSITIONING & BRAND PROMISES ── */}
      {overview.positioningSummaries && overview.positioningSummaries.length > 0 && (
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Feather name="crosshair" size={16} color="#8B5CF6" style={{ marginRight: 8 }} />
            <Text style={styles.sectionTitle}>SECTION B: COMPETITOR POSITIONING & PROMISES</Text>
          </View>
          <Text style={styles.sectionSubtitle}>
            Verified market positioning statements, distinguishing independently observed core offerings from self-asserted brand slogans.
          </Text>

          <View style={styles.cardsGrid}>
            {overview.positioningSummaries.map((pos) => (
              <View key={pos.competitorId} style={styles.positioningCard}>
                <View style={styles.cardHeaderRow}>
                  <Pressable
                    style={styles.compLinkRow}
                    onPress={() => onSelectCompetitor(pos.competitorId)}
                  >
                    <Text style={styles.compNameLink}>{pos.competitorName}</Text>
                    <Feather name="arrow-up-right" size={12} color="#A78BFA" style={{ marginLeft: 4 }} />
                  </Pressable>
                  {pos.isBrandClaim ? (
                    <View style={styles.brandClaimBadge}>
                      <Feather name="tag" size={10} color="#F59E0B" style={{ marginRight: 4 }} />
                      <Text style={styles.brandClaimBadgeText}>ATTRIBUTED BRAND CLAIM</Text>
                    </View>
                  ) : (
                    <View style={styles.verifiedBadge}>
                      <Feather name="shield" size={10} color="#10B981" style={{ marginRight: 4 }} />
                      <Text style={styles.verifiedBadgeText}>VERIFIED ARCHITECTURE</Text>
                    </View>
                  )}
                </View>

                <View style={styles.blockRow}>
                  <Text style={styles.blockLabel}>CORE PROMISE</Text>
                  <Text style={styles.blockValueHighlight}>"{pos.primaryPromise}"</Text>
                </View>

                <View style={styles.blockRow}>
                  <Text style={styles.blockLabel}>POSITIONING STATEMENT</Text>
                  <Text style={styles.blockValueText}>{pos.positioningStatement}</Text>
                </View>

                {pos.claimSource && (
                  <View style={styles.sourceRow}>
                    <Feather name="file-text" size={11} color="#6B7280" style={{ marginRight: 5 }} />
                    <Text style={styles.sourceText}>Source: {pos.claimSource}</Text>
                  </View>
                )}
              </View>
            ))}
          </View>
        </View>
      )}

      {/* ── 3. SECTION C: PRODUCTS, PRICING & COMMERCIAL TERMS ── */}
      {overview.commercialTerms && overview.commercialTerms.length > 0 && (
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Feather name="shopping-bag" size={16} color="#10B981" style={{ marginRight: 8 }} />
            <Text style={styles.sectionTitle}>SECTION C: PRODUCTS, PRICING & COMMERCIAL POLICIES</Text>
          </View>
          <Text style={styles.sectionSubtitle}>
            Published fulfillment and commercial specifications extracted directly from competitor policy architectures. Shipping thresholds are explicitly separated from product unit prices.
          </Text>

          {overview.pricingSummary && (
            <View style={styles.pricingSummaryBox}>
              <Feather name="info" size={13} color="#60A5FA" style={{ marginRight: 6, marginTop: 2 }} />
              <Text style={styles.pricingSummaryText}>{overview.pricingSummary}</Text>
            </View>
          )}

          <View style={styles.cardsGrid}>
            {overview.commercialTerms.map((term, idx) => (
              <View key={idx} style={styles.commercialCard}>
                <View style={styles.cardHeaderRow}>
                  <Text style={styles.termCompName}>{term.competitorName}</Text>
                  <View style={[
                    styles.termTypeBadge,
                    term.termType === 'SHIPPING' && { backgroundColor: '#3B82F620', borderColor: '#3B82F650' },
                    term.termType === 'RETURNS' && { backgroundColor: '#10B98120', borderColor: '#10B98150' },
                    term.termType === 'DELIVERY' && { backgroundColor: '#F59E0B20', borderColor: '#F59E0B50' },
                  ]}>
                    <Text style={[
                      styles.termTypeBadgeText,
                      term.termType === 'SHIPPING' && { color: '#60A5FA' },
                      term.termType === 'RETURNS' && { color: '#34D399' },
                      term.termType === 'DELIVERY' && { color: '#FBBF24' },
                    ]}>{term.termType}</Text>
                  </View>
                </View>

                <Text style={styles.termLabel}>{term.label}</Text>
                <Text style={styles.termDetail}>{term.detail}</Text>

                <View style={styles.sourceRow}>
                  <Feather name="check" size={11} color="#6B7280" style={{ marginRight: 5 }} />
                  <Text style={styles.sourceText}>{term.evidenceContext}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* ── 4. SECTION D: ATTRIBUTED CUSTOMER VOICE (REDDIT / TRUSTPILOT) ── */}
      {overview.customerVoiceEvidence && overview.customerVoiceEvidence.length > 0 && (
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Feather name="message-square" size={16} color="#EC4899" style={{ marginRight: 8 }} />
            <Text style={styles.sectionTitle}>SECTION D: ATTRIBUTED CUSTOMER VOICE & FORUM FEEDBACK</Text>
          </View>
          <Text style={styles.sectionSubtitle}>
            Verbatim buyer discussions, product evaluations, and unmet needs cited from public community channels.
          </Text>

          <View style={styles.cardsGrid}>
            {overview.customerVoiceEvidence.map((cv) => (
              <View key={cv.id} style={styles.voiceCard}>
                <View style={styles.cardHeaderRow}>
                  <View style={styles.platformBadge}>
                    <Feather
                      name={cv.platform.includes('reddit') ? 'message-circle' : 'star'}
                      size={11}
                      color="#F472B6"
                      style={{ marginRight: 4 }}
                    />
                    <Text style={styles.platformBadgeText}>{cv.platform.toUpperCase()}</Text>
                  </View>
                  {cv.competitorName && (
                    <View style={styles.voiceCompPill}>
                      <Text style={styles.voiceCompPillText}>{cv.competitorName}</Text>
                    </View>
                  )}
                  {cv.publishedDate && (
                    <Text style={styles.voiceDateText}>{cv.publishedDate}</Text>
                  )}
                </View>

                <Text style={styles.voiceThemeLabel}>STRATEGIC THEME: {cv.strategicTheme}</Text>
                <Text style={styles.voiceQuote}>"{cv.verbatimExcerpt}"</Text>

                {cv.sourceUrl && (
                  <Pressable style={styles.sourceUrlRow} onPress={() => openUrl(cv.sourceUrl)}>
                    <Feather name="external-link" size={11} color="#9CA3AF" style={{ marginRight: 4 }} />
                    <Text style={styles.sourceUrlText} numberOfLines={1}>{cv.sourceUrl}</Text>
                  </Pressable>
                )}
              </View>
            ))}
          </View>
        </View>
      )}

      {/* ── 5. SECTION E: MARKETING & CONTENT PATTERNS ── */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <Feather name="layout" size={16} color="#8B5CF6" style={{ marginRight: 8 }} />
          <Text style={styles.sectionTitle}>SECTION E: MARKETING & CONTENT CREATIVE PATTERNS</Text>
        </View>
        <Text style={styles.sectionSubtitle}>
          Content execution frameworks and creative hook angles observed across competitor distribution channels (strictly categorized under content strategy).
        </Text>

        <View style={styles.patternsList}>
          {overview.keyPatterns.length === 0 ? (
            <View style={styles.emptyPatternsBox}>
              <Feather name="info" size={18} color="#9CA3AF" style={{ marginBottom: 6 }} />
              <Text style={styles.emptyPatternsTitle}>No cross-competitor patterns detected</Text>
              <Text style={styles.emptyPatternsText}>
                No shared messaging, hook, or positioning patterns have reached convergence threshold in current competitor evidence.
              </Text>
            </View>
          ) : (
            overview.keyPatterns.map((pat) => (
              <View key={pat.id} style={styles.patternCard}>
                <View style={styles.patternHeader}>
                  <Text style={styles.patternName}>{pat.patternName}</Text>
                  <View style={styles.categoryBadge}>
                    <Text style={styles.categoryBadgeText}>{pat.category.toUpperCase()} PATTERN</Text>
                  </View>
                </View>

                <View style={styles.patternBlock}>
                  <Text style={styles.patternBlockLabel}>WHAT WE ARE SEEING</Text>
                  <Text style={styles.patternBlockText}>{pat.whatWeAreSeeing}</Text>
                </View>

                <View style={styles.whoBlock}>
                  <Text style={styles.patternBlockLabel}>SEEN ACROSS COMPETITORS</Text>
                  <View style={styles.competitorsRow}>
                    {pat.whoIsDoingIt.map((c) => (
                      <Pressable
                        key={c.competitorId}
                        style={styles.compPill}
                        onPress={() => onSelectCompetitor(c.competitorId)}
                      >
                        <Text style={styles.compPillText}>{c.competitorName}</Text>
                        <Feather name="arrow-up-right" size={11} color="#A78BFA" style={{ marginLeft: 4 }} />
                      </Pressable>
                    ))}
                  </View>
                </View>

                <View style={styles.patternBlock}>
                  <Text style={[styles.patternBlockLabel, { color: '#10B981' }]}>WHY IT MATTERS FOR YOUR STRATEGY</Text>
                  <Text style={styles.patternBlockText}>{pat.whyItMatters}</Text>
                </View>

                <View style={styles.evidenceFoot}>
                  <Feather name="file-text" size={12} color="#6B7280" style={{ marginRight: 6 }} />
                  <Text style={styles.evidenceFootText}>{pat.evidenceSummary}</Text>
                </View>
              </View>
            ))
          )}
        </View>
      </View>

      {/* ── 6. SECTION F: GROUNDED OPPORTUNITIES & WHAT TO WATCH ── */}
      <View style={styles.openingsGrid}>
        <View style={styles.openingCol}>
          <View style={styles.openingColHeader}>
            <Feather name="compass" size={15} color="#10B981" style={{ marginRight: 6 }} />
            <Text style={[styles.openingColTitle, { color: '#10B981' }]}>GROUNDED STRATEGIC OPENINGS</Text>
          </View>
          {overview.groundedFindings?.opportunities && overview.groundedFindings.opportunities.length > 0 ? (
            overview.groundedFindings.opportunities.map((opp, idx) => (
              <View key={idx} style={styles.groundedItem}>
                <View style={styles.groundedItemHeader}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Feather name="check-circle" size={14} color="#10B981" style={{ marginRight: 6 }} />
                      <Text style={styles.groundedTitle}>{opp.title}</Text>
                    </View>
                    {opp.scopeLabel && (
                      <View style={[
                        styles.scopeBadge,
                        opp.scopeTag === 'OBSERVED_IN_TARGET_MARKET' && styles.scopeBadgeLocal,
                        opp.scopeTag === 'GLOBAL_PATTERN' && styles.scopeBadgeGlobal,
                        opp.scopeTag === 'PROPOSED_OPPORTUNITY' && styles.scopeBadgeProposed,
                      ]}>
                        <Feather
                          name={opp.scopeTag === 'OBSERVED_IN_TARGET_MARKET' ? 'map-pin' : (opp.scopeTag === 'GLOBAL_PATTERN' ? 'globe' : 'zap')}
                          size={10}
                          color={opp.scopeTag === 'OBSERVED_IN_TARGET_MARKET' ? '#34D399' : (opp.scopeTag === 'GLOBAL_PATTERN' ? '#60A5FA' : '#FBBF24')}
                          style={{ marginRight: 4 }}
                        />
                        <Text style={[
                          styles.scopeBadgeText,
                          opp.scopeTag === 'OBSERVED_IN_TARGET_MARKET' && { color: '#34D399' },
                          opp.scopeTag === 'GLOBAL_PATTERN' && { color: '#60A5FA' },
                          opp.scopeTag === 'PROPOSED_OPPORTUNITY' && { color: '#FBBF24' },
                        ]}>
                          {opp.scopeLabel}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
                <Text style={styles.groundedObservation}>{opp.observation}</Text>
                <View style={styles.prereqBox}>
                  <Text style={styles.prereqLabel}>PREREQUISITE TO WIN:</Text>
                  <Text style={styles.prereqText}>{opp.prerequisite}</Text>
                </View>
                <Text style={styles.evidenceTag}>Evidence: {opp.groundedEvidence}</Text>
              </View>
            ))
          ) : (
            overview.opportunities.map((opp, idx) => (
              <View key={idx} style={styles.openingItem}>
                <Feather name="check" size={13} color="#10B981" style={{ marginTop: 3, marginRight: 8 }} />
                <Text style={styles.openingText}>{opp}</Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.openingCol}>
          <View style={styles.openingColHeader}>
            <Feather name="alert-triangle" size={15} color="#F59E0B" style={{ marginRight: 6 }} />
            <Text style={[styles.openingColTitle, { color: '#F59E0B' }]}>WHAT TO WATCH & REGIONAL RISKS</Text>
          </View>
          {overview.groundedFindings?.risks && overview.groundedFindings.risks.length > 0 ? (
            overview.groundedFindings.risks.map((risk, idx) => (
              <View key={idx} style={styles.groundedItem}>
                <View style={styles.groundedItemHeader}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Feather name="alert-circle" size={14} color="#F59E0B" style={{ marginRight: 6 }} />
                      <Text style={[styles.groundedTitle, { color: '#FBBF24' }]}>{risk.title}</Text>
                    </View>
                    {risk.scopeLabel && (
                      <View style={[
                        styles.scopeBadge,
                        risk.scopeTag === 'OBSERVED_IN_TARGET_MARKET' && styles.scopeBadgeLocal,
                        risk.scopeTag === 'GLOBAL_PATTERN' && styles.scopeBadgeGlobal,
                        risk.scopeTag === 'PROPOSED_OPPORTUNITY' && styles.scopeBadgeProposed,
                      ]}>
                        <Feather
                          name={risk.scopeTag === 'OBSERVED_IN_TARGET_MARKET' ? 'map-pin' : (risk.scopeTag === 'GLOBAL_PATTERN' ? 'globe' : 'zap')}
                          size={10}
                          color={risk.scopeTag === 'OBSERVED_IN_TARGET_MARKET' ? '#34D399' : (risk.scopeTag === 'GLOBAL_PATTERN' ? '#60A5FA' : '#FBBF24')}
                          style={{ marginRight: 4 }}
                        />
                        <Text style={[
                          styles.scopeBadgeText,
                          risk.scopeTag === 'OBSERVED_IN_TARGET_MARKET' && { color: '#34D399' },
                          risk.scopeTag === 'GLOBAL_PATTERN' && { color: '#60A5FA' },
                          risk.scopeTag === 'PROPOSED_OPPORTUNITY' && { color: '#FBBF24' },
                        ]}>
                          {risk.scopeLabel}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
                <Text style={styles.groundedObservation}>{risk.riskFactor}</Text>
                <View style={[styles.prereqBox, { borderColor: '#F59E0B40', backgroundColor: '#F59E0B10' }]}>
                  <Text style={[styles.prereqLabel, { color: '#F59E0B' }]}>MITIGATION STRATEGY:</Text>
                  <Text style={styles.prereqText}>{risk.mitigation}</Text>
                </View>
                {risk.competitorsExhibiting?.length > 0 && (
                  <Text style={styles.evidenceTag}>Observed in: {risk.competitorsExhibiting.join(', ')}</Text>
                )}
              </View>
            ))
          ) : (
            overview.threats.map((thr, idx) => (
              <View key={idx} style={styles.openingItem}>
                <Feather name="eye" size={13} color="#F59E0B" style={{ marginTop: 3, marginRight: 8 }} />
                <Text style={styles.openingText}>{thr}</Text>
              </View>
            ))
          )}
        </View>
      </View>

      {/* ── 7. SECTION G: MARKET SYNTHESIS & STRATEGIC DIAGNOSIS ── */}
      {overview.marketDiagnosis && (
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Feather name="target" size={16} color="#A78BFA" style={{ marginRight: 8 }} />
            <Text style={styles.sectionTitle}>SECTION G: MARKET SYNTHESIS & STRATEGIC DIAGNOSIS</Text>
          </View>
          <Text style={styles.sectionSubtitle}>
            Strategic synthesis of competitive dynamics in {overview.targetMarket || 'the target market'} and the defensible positioning thesis for your brand.
          </Text>
          <View style={styles.diagnosisBox}>
            <Text style={styles.diagnosisText}>{overview.marketDiagnosis}</Text>
          </View>
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
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#10B98115',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
    marginRight: 6,
  },
  statusText: {
    color: '#10B981',
    fontSize: 11,
    fontWeight: '600',
  },
  heroTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 8,
    lineHeight: 32,
  },
  heroSummary: {
    fontSize: 15,
    color: '#D1D5DB',
    lineHeight: 22,
    marginBottom: 18,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#1F2937',
    marginBottom: 16,
  },
  metricCard: {
    flex: 1,
    minWidth: 180,
    backgroundColor: '#11161F',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1E2535',
    padding: 12,
  },
  metricHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  metricLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9CA3AF',
    letterSpacing: 0.5,
  },
  metricValue: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  metricSub: {
    fontSize: 11,
    color: '#6B7280',
  },
  confidenceBanner: {
    backgroundColor: '#1F293750',
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 8,
    padding: 12,
  },
  confidenceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  confidenceTitle: {
    fontSize: 13,
    color: '#D1D5DB',
  },
  confidenceText: {
    fontSize: 12,
    color: '#9CA3AF',
    lineHeight: 18,
  },
  cohortBanner: {
    marginTop: 12,
    backgroundColor: '#10B98110',
    borderWidth: 1,
    borderColor: '#10B98135',
    borderRadius: 8,
    padding: 12,
  },
  cohortHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 6,
  },
  cohortTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#E5E7EB',
  },
  cohortSourcePill: {
    backgroundColor: '#10B98120',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#10B98140',
  },
  cohortSourceText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#34D399',
    letterSpacing: 0.3,
  },
  cohortDesc: {
    fontSize: 12,
    color: '#D1D5DB',
    lineHeight: 17,
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
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: '#9CA3AF',
    marginBottom: 18,
    lineHeight: 19,
  },
  cardsGrid: {
    gap: 14,
  },
  positioningCard: {
    backgroundColor: '#11161F',
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1E2535',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    flexWrap: 'wrap',
    gap: 8,
  },
  compLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  compNameLink: {
    fontSize: 15,
    fontWeight: '700',
    color: '#A78BFA',
  },
  brandClaimBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F59E0B20',
    borderWidth: 1,
    borderColor: '#F59E0B50',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  brandClaimBadgeText: {
    color: '#FBBF24',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#10B98120',
    borderWidth: 1,
    borderColor: '#10B98150',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  verifiedBadgeText: {
    color: '#34D399',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  blockRow: {
    marginBottom: 8,
  },
  blockLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#9CA3AF',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  blockValueHighlight: {
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: '600',
    lineHeight: 20,
  },
  blockValueText: {
    fontSize: 13,
    color: '#D1D5DB',
    lineHeight: 18,
  },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#1F2937',
    marginTop: 4,
  },
  sourceText: {
    fontSize: 11,
    color: '#6B7280',
    fontStyle: 'italic',
  },
  commercialCard: {
    backgroundColor: '#11161F',
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1E2535',
  },
  termCompName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#9CA3AF',
  },
  termTypeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
  },
  termTypeBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  termLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  termDetail: {
    fontSize: 13,
    color: '#D1D5DB',
    lineHeight: 19,
    marginBottom: 8,
  },
  voiceCard: {
    backgroundColor: '#11161F',
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1E2535',
  },
  platformBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EC489920',
    borderWidth: 1,
    borderColor: '#EC489950',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  platformBadgeText: {
    color: '#F472B6',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  voiceCompPill: {
    backgroundColor: '#1F2937',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  voiceCompPillText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#D1D5DB',
  },
  voiceDateText: {
    fontSize: 11,
    color: '#6B7280',
    marginLeft: 'auto',
  },
  voiceThemeLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#A78BFA',
    marginTop: 8,
    marginBottom: 4,
  },
  voiceQuote: {
    fontSize: 13,
    color: '#E5E7EB',
    fontStyle: 'italic',
    lineHeight: 20,
    marginBottom: 8,
  },
  sourceUrlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#1F2937',
  },
  sourceUrlText: {
    fontSize: 11,
    color: '#9CA3AF',
    flex: 1,
  },
  patternsList: {
    gap: 16,
  },
  patternCard: {
    backgroundColor: '#11161F',
    borderRadius: 8,
    padding: 18,
    borderWidth: 1,
    borderColor: '#1E2535',
  },
  patternHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  patternName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    flex: 1,
    marginRight: 10,
  },
  categoryBadge: {
    backgroundColor: '#1F2937',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  categoryBadgeText: {
    color: '#9CA3AF',
    fontSize: 10,
    fontWeight: '700',
  },
  patternBlock: {
    marginBottom: 12,
  },
  patternBlockLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#9CA3AF',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  patternBlockText: {
    fontSize: 13,
    color: '#E5E7EB',
    lineHeight: 19,
  },
  whoBlock: {
    marginBottom: 12,
  },
  competitorsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  compPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1F2937',
    borderWidth: 1,
    borderColor: '#374151',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  compPillText: {
    color: '#E5E7EB',
    fontSize: 12,
    fontWeight: '600',
  },
  evidenceFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#1F2937',
    marginTop: 4,
  },
  evidenceFootText: {
    fontSize: 11,
    color: '#6B7280',
    fontStyle: 'italic',
  },
  openingsGrid: {
    flexDirection: 'row',
    gap: 16,
    flexWrap: 'wrap',
    marginBottom: 20,
  },
  openingCol: {
    flex: 1,
    minWidth: 320,
    backgroundColor: '#161B22',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E2535',
    padding: 20,
  },
  openingColHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  openingColTitle: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  groundedItem: {
    backgroundColor: '#11161F',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1E2535',
    padding: 14,
    marginBottom: 12,
  },
  groundedItemHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  groundedTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
    flex: 1,
    lineHeight: 18,
  },
  groundedObservation: {
    fontSize: 13,
    color: '#D1D5DB',
    lineHeight: 18,
    marginBottom: 10,
  },
  prereqBox: {
    backgroundColor: '#10B98110',
    borderWidth: 1,
    borderColor: '#10B98130',
    borderRadius: 6,
    padding: 8,
    marginBottom: 8,
  },
  prereqLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#34D399',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  prereqText: {
    fontSize: 12,
    color: '#E5E7EB',
    lineHeight: 16,
  },
  evidenceTag: {
    fontSize: 11,
    color: '#6B7280',
    fontStyle: 'italic',
  },
  openingItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  openingText: {
    fontSize: 13,
    color: '#D1D5DB',
    flex: 1,
    lineHeight: 18,
  },
  emptyPatternsBox: {
    padding: 24,
    borderRadius: 8,
    backgroundColor: '#1E253540',
    borderWidth: 1,
    borderColor: '#374151',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyPatternsTitle: {
    color: '#E5E7EB',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  emptyPatternsText: {
    color: '#9CA3AF',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    maxWidth: 480,
  },
  targetMarketPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#10B98115',
    borderColor: '#10B98130',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  targetMarketPillText: {
    color: '#34D399',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  pricingSummaryBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#1E293B50',
    borderColor: '#3B82F630',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: 16,
  },
  pricingSummaryText: {
    fontSize: 12,
    color: '#93C5FD',
    lineHeight: 17,
    flex: 1,
  },
  scopeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 4,
    marginBottom: 6,
    borderWidth: 1,
  },
  scopeBadgeLocal: {
    backgroundColor: '#10B98115',
    borderColor: '#10B98135',
  },
  scopeBadgeGlobal: {
    backgroundColor: '#3B82F615',
    borderColor: '#3B82F635',
  },
  scopeBadgeProposed: {
    backgroundColor: '#F59E0B15',
    borderColor: '#F59E0B35',
  },
  scopeBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  diagnosisBox: {
    backgroundColor: '#11161F',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1E2535',
    padding: 16,
    marginTop: 8,
  },
  diagnosisText: {
    fontSize: 14,
    color: '#E5E7EB',
    lineHeight: 22,
  },
});
