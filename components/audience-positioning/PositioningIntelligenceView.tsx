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

export default function PositioningIntelligenceView({ data }: Props) {
  const [showDecisionHistory, setShowDecisionHistory] = useState(false);

  const { positioning } = data;
  const { reasoningJourney, brandSpine, validation, decisionHistory } = positioning;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false}>
      {/* ── 1. FINAL POSITION HERO ── */}
      <View style={styles.heroCard}>
        <View style={styles.heroHeader}>
          <View style={styles.badgePrimary}>
            <Feather name="compass" size={12} color="#A78BFA" style={{ marginRight: 5 }} />
            <Text style={styles.badgePrimaryText}>YOUR MARKET POSITION</Text>
          </View>
          <View style={styles.statusPill}>
            <View style={styles.statusDot} />
            <Text style={styles.statusText}>Approved Strategy</Text>
          </View>
        </View>

        <Text style={styles.heroTitle}>{positioning.umbrellaPosition}</Text>
        <Text style={styles.heroStatement}>"{positioning.positioningStatement}"</Text>

        {positioning.contrastAxis ? (
          <View style={styles.contrastBox}>
            <Text style={styles.contrastLabel}>STRATEGIC CONTRAST AXIS</Text>
            <Text style={styles.contrastText}>{positioning.contrastAxis}</Text>
          </View>
        ) : null}
      </View>

      {/* ── 2. REASONING JOURNEY (01 - 04) ── */}
      <View style={styles.journeyCard}>
        <View style={styles.sectionHeader}>
          <Feather name="git-merge" size={16} color="#8B5CF6" style={{ marginRight: 8 }} />
          <Text style={styles.sectionTitle}>WHY AVYRON CHOSE THIS POSITION</Text>
        </View>
        <Text style={styles.sectionSubtitle}>
          A clear 4-step intelligence journey connecting the buyer problem to your product truth, differentiation, and final market territory.
        </Text>

        <View style={styles.stepsContainer}>
          {/* STEP 1 */}
          <View style={styles.stepBlock}>
            <View style={styles.stepLeftCol}>
              <View style={styles.stepNumberWrap}>
                <Text style={styles.stepNumber}>01</Text>
              </View>
              <View style={styles.stepVerticalLine} />
            </View>
            <View style={styles.stepBody}>
              <View style={styles.stepHeaderRow}>
                <Text style={styles.stepLabel}>{reasoningJourney.step1.label}</Text>
                <View style={styles.sourceTag}>
                  <Text style={styles.sourceTagText}>{reasoningJourney.step1.source}</Text>
                </View>
              </View>
              <Text style={styles.stepTitle}>{reasoningJourney.step1.title}</Text>
              <Text style={styles.stepDescription}>{reasoningJourney.step1.description}</Text>
            </View>
          </View>

          {/* STEP 2 */}
          <View style={styles.stepBlock}>
            <View style={styles.stepLeftCol}>
              <View style={styles.stepNumberWrap}>
                <Text style={styles.stepNumber}>02</Text>
              </View>
              <View style={styles.stepVerticalLine} />
            </View>
            <View style={styles.stepBody}>
              <View style={styles.stepHeaderRow}>
                <Text style={styles.stepLabel}>{reasoningJourney.step2.label}</Text>
                <View style={styles.sourceTag}>
                  <Text style={styles.sourceTagText}>{reasoningJourney.step2.source}</Text>
                </View>
              </View>
              <Text style={styles.stepTitle}>{reasoningJourney.step2.title}</Text>
              <Text style={styles.stepDescription}>{reasoningJourney.step2.description}</Text>
              {reasoningJourney.step2.capability && (
                <View style={styles.capabilityBadge}>
                  <Feather name="cpu" size={12} color="#10B981" style={{ marginRight: 6 }} />
                  <Text style={styles.capabilityText}>{reasoningJourney.step2.capability}</Text>
                </View>
              )}
            </View>
          </View>

          {/* STEP 3 */}
          <View style={styles.stepBlock}>
            <View style={styles.stepLeftCol}>
              <View style={styles.stepNumberWrap}>
                <Text style={styles.stepNumber}>03</Text>
              </View>
              <View style={styles.stepVerticalLine} />
            </View>
            <View style={styles.stepBody}>
              <View style={styles.stepHeaderRow}>
                <Text style={styles.stepLabel}>{reasoningJourney.step3.label}</Text>
                <View style={styles.sourceTag}>
                  <Text style={styles.sourceTagText}>{reasoningJourney.step3.source}</Text>
                </View>
              </View>
              <Text style={styles.stepTitle}>{reasoningJourney.step3.title}</Text>
              <Text style={styles.stepDescription}>{reasoningJourney.step3.description}</Text>
              {reasoningJourney.step3.contrast && (
                <View style={styles.contrastBadge}>
                  <Feather name="shield" size={12} color="#F59E0B" style={{ marginRight: 6 }} />
                  <Text style={styles.contrastBadgeText}>{reasoningJourney.step3.contrast}</Text>
                </View>
              )}
            </View>
          </View>

          {/* STEP 4 */}
          <View style={styles.stepBlock}>
            <View style={styles.stepLeftCol}>
              <View style={[styles.stepNumberWrap, { backgroundColor: '#8B5CF6', borderColor: '#A78BFA' }]}>
                <Text style={[styles.stepNumber, { color: '#FFFFFF' }]}>04</Text>
              </View>
            </View>
            <View style={styles.stepBody}>
              <View style={styles.stepHeaderRow}>
                <Text style={[styles.stepLabel, { color: '#A78BFA' }]}>{reasoningJourney.step4.label}</Text>
                <View style={[styles.sourceTag, { backgroundColor: '#8B5CF620', borderColor: '#8B5CF640' }]}>
                  <Text style={[styles.sourceTagText, { color: '#A78BFA' }]}>{reasoningJourney.step4.source}</Text>
                </View>
              </View>
              <Text style={styles.stepTitle}>{reasoningJourney.step4.title}</Text>
              <Text style={styles.stepDescription}>{reasoningJourney.step4.description}</Text>
            </View>
          </View>
        </View>
      </View>

      {/* ── 3. BRAND CONNECTION (BRAND SPINE) ── */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <Feather name="link" size={16} color="#8B5CF6" style={{ marginRight: 8 }} />
          <Text style={styles.sectionTitle}>HOW THE STRATEGY CONNECTS</Text>
        </View>
        <Text style={styles.sectionSubtitle}>
          The unified Brand Spine showing end-to-end alignment from product capability to market positioning.
        </Text>

        <View style={styles.brandSpineFlow}>
          <View style={styles.spineNode}>
            <View style={styles.spineNodeHeader}>
              <Feather name="check-circle" size={13} color="#3B82F6" style={{ marginRight: 6 }} />
              <Text style={styles.spineNodeTag}>PRODUCT TRUTH</Text>
            </View>
            <Text style={styles.spineNodeTitle}>{brandSpine.productTruth}</Text>
          </View>

          <View style={styles.spineArrow}>
            <Feather name="arrow-right" size={16} color="#6B7280" />
          </View>

          <View style={styles.spineNode}>
            <View style={styles.spineNodeHeader}>
              <Feather name="shield" size={13} color="#F59E0B" style={{ marginRight: 6 }} />
              <Text style={styles.spineNodeTag}>DIFFERENTIATION</Text>
            </View>
            <Text style={styles.spineNodeTitle}>{brandSpine.differentiation}</Text>
          </View>

          <View style={styles.spineArrow}>
            <Feather name="arrow-right" size={16} color="#6B7280" />
          </View>

          <View style={[styles.spineNode, { borderColor: '#8B5CF6', backgroundColor: '#8B5CF610' }]}>
            <View style={styles.spineNodeHeader}>
              <Feather name="target" size={13} color="#A78BFA" style={{ marginRight: 6 }} />
              <Text style={[styles.spineNodeTag, { color: '#A78BFA' }]}>POSITIONING</Text>
            </View>
            <Text style={[styles.spineNodeTitle, { color: '#FFFFFF', fontWeight: '700' }]}>{brandSpine.positioning}</Text>
          </View>
        </View>
      </View>

      {/* ── 4. HOW THIS DECISION WAS VALIDATED ── */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <Feather name="check-square" size={16} color="#10B981" style={{ marginRight: 8 }} />
          <Text style={styles.sectionTitle}>HOW THIS DECISION WAS VALIDATED</Text>
        </View>
        <Text style={styles.sectionSubtitle}>
          Multi-layer integrity gates verified this positioning choice against buyer pain, product truth, and competitor whitespace.
        </Text>

        <View style={styles.validationGrid}>
          {validation.map((v, idx) => (
            <View key={idx} style={styles.validationItem}>
              <View style={styles.validationIconBox}>
                <Feather name="check" size={14} color="#10B981" />
              </View>
              <View style={styles.validationTextCol}>
                <Text style={styles.validationLabel}>{v.label}</Text>
                <Text style={styles.validationDetail}>{v.detail}</Text>
              </View>
            </View>
          ))}
        </View>
      </View>

      {/* ── 5. DECISION HISTORY (COLLAPSED BY DEFAULT) ── */}
      {decisionHistory.length > 0 && (
        <View style={styles.accordionContainer}>
          <Pressable
            style={styles.accordionHeader}
            onPress={() => setShowDecisionHistory(!showDecisionHistory)}
          >
            <View style={styles.accordionLeft}>
              <Feather name="archive" size={16} color="#6B7280" style={{ marginRight: 8 }} />
              <Text style={[styles.accordionTitle, { color: '#9CA3AF' }]}>Decision History: Explored Alternatives</Text>
              <View style={[styles.badgeMini, { backgroundColor: '#374151' }]}>
                <Text style={[styles.badgeMiniText, { color: '#9CA3AF' }]}>{decisionHistory.length} Considered</Text>
              </View>
            </View>
            <Feather name={showDecisionHistory ? 'chevron-up' : 'chevron-down'} size={18} color="#6B7280" />
          </Pressable>

          {showDecisionHistory && (
            <View style={styles.accordionBody}>
              <Text style={styles.historyIntro}>
                Alternative strategic angles evaluated during synthesis and why they were not chosen as the primary market position:
              </Text>
              {decisionHistory.map((d, idx) => (
                <View key={idx} style={styles.historyCard}>
                  <View style={styles.historyCardHeader}>
                    <Text style={styles.historyTitle}>{d.alternative}</Text>
                    <View style={styles.historyStatusBadge}>
                      <Text style={styles.historyStatusText}>{d.status}</Text>
                    </View>
                  </View>
                  <Text style={styles.historyReason}>{d.reason}</Text>
                  <Text style={styles.historyAuthority}>Authority: {d.authority}</Text>
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
    borderColor: '#8B5CF640',
    padding: 24,
    marginBottom: 20,
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
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
    marginBottom: 10,
    lineHeight: 32,
  },
  heroStatement: {
    fontSize: 15,
    fontStyle: 'italic',
    color: '#D1D5DB',
    lineHeight: 22,
    marginBottom: 16,
  },
  contrastBox: {
    backgroundColor: '#11161F',
    borderRadius: 8,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1E2535',
  },
  contrastLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#9CA3AF',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  contrastText: {
    fontSize: 13,
    color: '#E5E7EB',
    lineHeight: 18,
  },
  journeyCard: {
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
    marginBottom: 20,
  },
  stepsContainer: {
    marginTop: 8,
  },
  stepBlock: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  stepLeftCol: {
    alignItems: 'center',
    width: 36,
    marginRight: 14,
  },
  stepNumberWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#1F2937',
    borderWidth: 1,
    borderColor: '#374151',
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepNumber: {
    fontSize: 12,
    fontWeight: '800',
    color: '#D1D5DB',
  },
  stepVerticalLine: {
    width: 2,
    flex: 1,
    backgroundColor: '#1F2937',
    marginVertical: 6,
  },
  stepBody: {
    flex: 1,
    backgroundColor: '#11161F',
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1E2535',
    marginBottom: 16,
  },
  stepHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  stepLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#9CA3AF',
    letterSpacing: 0.5,
  },
  sourceTag: {
    backgroundColor: '#1F2937',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#374151',
  },
  sourceTagText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#9CA3AF',
  },
  stepTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 6,
  },
  stepDescription: {
    fontSize: 13,
    color: '#D1D5DB',
    lineHeight: 19,
    marginBottom: 8,
  },
  capabilityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#10B98110',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  capabilityText: {
    color: '#10B981',
    fontSize: 11,
    fontWeight: '600',
  },
  contrastBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F59E0B10',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  contrastBadgeText: {
    color: '#F59E0B',
    fontSize: 11,
    fontWeight: '600',
  },
  sectionCard: {
    backgroundColor: '#161B22',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E2535',
    padding: 24,
    marginBottom: 20,
  },
  brandSpineFlow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  spineNode: {
    flex: 1,
    minWidth: 200,
    backgroundColor: '#11161F',
    borderRadius: 8,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1E2535',
  },
  spineNodeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  spineNodeTag: {
    fontSize: 10,
    fontWeight: '800',
    color: '#9CA3AF',
    letterSpacing: 0.5,
  },
  spineNodeTitle: {
    fontSize: 13,
    color: '#E5E7EB',
    lineHeight: 18,
    fontWeight: '500',
  },
  spineArrow: {
    paddingHorizontal: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  validationGrid: {
    gap: 10,
  },
  validationItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#11161F',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1E2535',
  },
  validationIconBox: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#10B98120',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
    marginTop: 2,
  },
  validationTextCol: {
    flex: 1,
  },
  validationLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  validationDetail: {
    fontSize: 12,
    color: '#9CA3AF',
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
    fontSize: 14,
    fontWeight: '600',
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
    fontSize: 11,
    fontWeight: '600',
  },
  accordionBody: {
    padding: 16,
    paddingTop: 0,
    borderTopWidth: 1,
    borderTopColor: '#1F2937',
  },
  historyIntro: {
    fontSize: 13,
    color: '#9CA3AF',
    marginVertical: 12,
  },
  historyCard: {
    backgroundColor: '#11161F',
    padding: 14,
    borderRadius: 6,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1E2535',
  },
  historyCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  historyTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#E5E7EB',
  },
  historyStatusBadge: {
    backgroundColor: '#1F2937',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  historyStatusText: {
    fontSize: 11,
    color: '#9CA3AF',
  },
  historyReason: {
    fontSize: 12,
    color: '#D1D5DB',
    lineHeight: 17,
    marginBottom: 4,
  },
  historyAuthority: {
    fontSize: 11,
    color: '#6B7280',
  },
});
