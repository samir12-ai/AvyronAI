import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { ShellTheme } from '@/constants/ShellTheme';
import type { CompetitorDossierViewModel } from '@/types/market-intelligence';

interface Props {
  dossier: CompetitorDossierViewModel;
  onBackToList?: () => void;
}

export default function CompetitorDossierView({ dossier, onBackToList }: Props) {
  const [showAllCapabilities, setShowAllCapabilities] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);

  const {
    identity,
    whatTheyDo,
    whatTheyOffer,
    whoTheyTarget,
    howTheyPosition,
    howTheyMarket,
    recurringIdeas,
    offersAndCommercialMotion,
    proofStrategy,
    whatChanged,
    whatThisTellsUs,
    howThisComparesToYou,
    opportunitiesAndThreats,
    evidenceDossier,
  } = dossier;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false}>
      {/* ── BACK BUTTON ── */}
      {onBackToList && (
        <Pressable style={styles.backBtn} onPress={onBackToList}>
          <Feather name="arrow-left" size={14} color="#A78BFA" style={{ marginRight: 6 }} />
          <Text style={styles.backBtnText}>Back to Competitor Library</Text>
        </Pressable>
      )}

      {/* ── 1. DOSSIER HERO ── */}
      <View style={styles.heroCard}>
        <View style={styles.heroHeader}>
          <View style={styles.badgePrimary}>
            <Feather name="file-text" size={12} color="#A78BFA" style={{ marginRight: 5 }} />
            <Text style={styles.badgePrimaryText}>COMPETITOR INTELLIGENCE DOSSIER</Text>
          </View>
          <View style={styles.freshnessBadge}>
            <View style={styles.greenDot} />
            <Text style={styles.freshnessText}>{identity.dataFreshnessLabel}</Text>
          </View>
        </View>

        <Text style={styles.compNameTitle}>{identity.name}</Text>
        <Text style={styles.heroSummaryText}>{identity.oneLineSummary}</Text>

        <View style={styles.heroMetaRow}>
          <View style={styles.metaItem}>
            <Feather name="tag" size={13} color="#9CA3AF" style={{ marginRight: 4 }} />
            <Text style={styles.metaLabel}>Category:</Text>
            <Text style={styles.metaVal}>{identity.category}</Text>
          </View>
          <View style={styles.metaDivider} />
          <View style={styles.metaItem}>
            <Feather name="globe" size={13} color="#9CA3AF" style={{ marginRight: 4 }} />
            <Text style={styles.metaLabel}>Website:</Text>
            <Text style={styles.metaVal}>{identity.websiteUrl || 'Direct Platform'}</Text>
          </View>
          <View style={styles.metaDivider} />
          <View style={styles.metaItem}>
            <Feather name="users" size={13} color="#9CA3AF" style={{ marginRight: 4 }} />
            <Text style={styles.metaLabel}>Primary Audience:</Text>
            <Text style={styles.metaVal}>{identity.primaryAudience}</Text>
          </View>
          <View style={styles.metaDivider} />
          <View style={styles.metaItem}>
            <Feather name="database" size={13} color="#9CA3AF" style={{ marginRight: 4 }} />
            <Text style={styles.metaLabel}>Sources Reviewed:</Text>
            <Text style={styles.metaVal}>{identity.sourcesReviewedCount} verified items</Text>
          </View>
        </View>
      </View>

      {/* ── 2. WHAT THEY DO ── */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <Feather name="briefcase" size={16} color="#8B5CF6" style={{ marginRight: 8 }} />
          <Text style={styles.sectionTitle}>WHAT THEY DO</Text>
        </View>
        <Text style={styles.sectionBodyText}>{whatTheyDo.coreProductSummary}</Text>

        <View style={styles.jobsBox}>
          <Text style={styles.subHeadLabel}>KEY JOBS PERFORMED</Text>
          <View style={styles.bulletList}>
            {whatTheyDo.keyJobs.map((job, idx) => (
              <View key={idx} style={styles.bulletRow}>
                <Feather name="check" size={13} color="#10B981" style={{ marginTop: 3, marginRight: 8 }} />
                <Text style={styles.bulletText}>{job}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>

      {/* ── 3. WHAT THEY OFFER (CAPABILITIES & FEATURES) ── */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeaderBetween}>
          <View style={styles.sectionHeader}>
            <Feather name="layers" size={16} color="#8B5CF6" style={{ marginRight: 8 }} />
            <Text style={styles.sectionTitle}>WHAT THEY OFFER</Text>
            <View style={styles.countPill}>
              <Text style={styles.countPillText}>{whatTheyOffer.totalCount} Capabilities Extracted</Text>
            </View>
          </View>
          <Pressable
            style={styles.toggleViewBtn}
            onPress={() => setShowAllCapabilities(!showAllCapabilities)}
          >
            <Text style={styles.toggleViewText}>
              {showAllCapabilities ? 'Show Grouped' : 'Show All Items'}
            </Text>
          </Pressable>
        </View>
        <Text style={styles.sectionSubtitle}>
          Complete functional capabilities extracted directly from website architecture and verified product collateral.
        </Text>

        {!showAllCapabilities ? (
          <View style={styles.groupsContainer}>
            {whatTheyOffer.semanticGroups.map((grp, gIdx) => (
              <View key={gIdx} style={styles.groupCard}>
                <Text style={styles.groupHeaderTitle}>{grp.groupName} ({grp.items.length})</Text>
                <View style={styles.groupItemsList}>
                  {grp.items.map((item) => (
                    <View key={item.id} style={styles.capItem}>
                      <View style={styles.capItemTop}>
                        <Text style={styles.capStatement}>{item.statement}</Text>
                        <View style={styles.statusMiniBadge}>
                          <Text style={styles.statusMiniText}>{item.statusLabel}</Text>
                        </View>
                      </View>
                      {item.rationale ? (
                        <Text style={styles.capRationale}>{item.rationale}</Text>
                      ) : null}
                    </View>
                  ))}
                </View>
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.allCapsList}>
            {whatTheyOffer.capabilities.map((item, idx) => (
              <View key={item.id || idx} style={styles.capItem}>
                <View style={styles.capItemTop}>
                  <Text style={styles.capStatement}>{item.statement}</Text>
                  <View style={styles.statusMiniBadge}>
                    <Text style={styles.statusMiniText}>{item.statusLabel}</Text>
                  </View>
                </View>
                {item.rationale ? (
                  <Text style={styles.capRationale}>{item.rationale}</Text>
                ) : null}
              </View>
            ))}
          </View>
        )}
      </View>

      {/* ── 4. WHO THEY SELL TO ── */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <Feather name="target" size={16} color="#8B5CF6" style={{ marginRight: 8 }} />
          <Text style={styles.sectionTitle}>WHO THEY ARE TARGETING</Text>
        </View>
        <Text style={styles.sectionSubtitle}>
          Target audience segments and decision-maker roles identified from pricing tiers and positioning copy.
        </Text>

        <View style={styles.rolesGrid}>
          {whoTheyTarget.targetRoles.map((r, idx) => (
            <View key={idx} style={styles.roleCard}>
              <View style={styles.roleHeader}>
                <Text style={styles.roleTitle}>{r.roleTitle}</Text>
                <View style={[styles.roleTypeBadge, r.roleType === 'BUYER' ? styles.buyerBadge : styles.userBadge]}>
                  <Text style={styles.roleTypeText}>{r.roleType}</Text>
                </View>
              </View>
              <Text style={styles.roleStatus}>{r.statusLabel}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* ── 5. HOW THEY POSITION THEMSELVES ── */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <Feather name="compass" size={16} color="#8B5CF6" style={{ marginRight: 8 }} />
          <Text style={styles.sectionTitle}>HOW THEY WANT THE MARKET TO SEE THEM</Text>
        </View>

        <View style={styles.posPrimaryBox}>
          <Text style={styles.posBoxLabel}>PRIMARY POSITION & CORE PROMISE</Text>
          <Text style={styles.posBoxStatement}>"{howTheyPosition.corePromise || howTheyPosition.primaryPosition}"</Text>
        </View>

        <View style={styles.mechanismsBox}>
          <Text style={styles.subHeadLabel}>MECHANISMS THEY PRESENT</Text>
          {howTheyPosition.mechanisms.map((m, idx) => (
            <View key={idx} style={styles.mechItem}>
              <Feather name="cpu" size={13} color="#8B5CF6" style={{ marginTop: 2, marginRight: 8 }} />
              <Text style={styles.mechText}>{m}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* ── 6. HOW THEY MARKET & PLAYBOOK ── */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <Feather name="activity" size={16} color="#8B5CF6" style={{ marginRight: 8 }} />
          <Text style={styles.sectionTitle}>HOW THEY MARKET & THEIR PLAYBOOK</Text>
        </View>
        <Text style={styles.sectionBodyText}>{howTheyMarket.marketingSystemSummary}</Text>

        {/* 4-Step Playbook */}
        <View style={styles.playbookContainer}>
          <Text style={styles.subHeadLabel}>OBSERVED MARKETING PLAYBOOK</Text>
          <View style={styles.playbookGrid}>
            {howTheyMarket.playbook.map((step) => (
              <View key={step.step} style={styles.playbookStepCard}>
                <View style={styles.stepHeader}>
                  <View style={styles.stepTag}>
                    <Text style={styles.stepTagText}>{step.step}</Text>
                  </View>
                  <Text style={styles.stepTacticBadge}>{step.observedTactic}</Text>
                </View>
                <Text style={styles.stepCardTitle}>{step.label}</Text>
                <Text style={styles.stepCardDesc}>{step.description}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>

      {/* ── 7. IDEAS THEY KEEP REPEATING ── */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <Feather name="repeat" size={16} color="#8B5CF6" style={{ marginRight: 8 }} />
          <Text style={styles.sectionTitle}>IDEAS THEY KEEP RETURNING TO</Text>
        </View>
        <Text style={styles.sectionSubtitle}>
          Recurring strategic themes and narratives repeated consistently across public channels.
        </Text>

        <View style={styles.recurringList}>
          {recurringIdeas.map((idea, idx) => (
            <View key={idx} style={styles.recurringCard}>
              <View style={styles.recurringHeader}>
                <Text style={styles.recurringIdeaText}>"{idea.idea}"</Text>
              </View>
              <View style={styles.recurringMetaRow}>
                <Text style={styles.recurringMetaText}><Text style={{ fontWeight: '700' }}>Where it appears:</Text> {idea.observedIn}</Text>
                <Text style={styles.recurringMetaText}><Text style={{ fontWeight: '700' }}>Strategic Objective:</Text> {idea.likelyObjective}</Text>
              </View>
            </View>
          ))}
        </View>
      </View>

      {/* ── 8. OFFERS & PROOF STRATEGY ── */}
      <View style={styles.dualGrid}>
        <View style={styles.dualCol}>
          <View style={styles.dualHeader}>
            <Feather name="shopping-bag" size={14} color="#F59E0B" style={{ marginRight: 6 }} />
            <Text style={styles.dualTitle}>OFFERS & CONVERSION MOTION</Text>
          </View>
          {offersAndCommercialMotion.offers.map((off, idx) => (
            <View key={idx} style={styles.miniCard}>
              <Text style={styles.miniCardTitle}>{off.offerStatement}</Text>
              <Text style={styles.miniCardDesc}>Entry: {off.freeEntry} | CTA: "{off.cta}"</Text>
            </View>
          ))}
        </View>

        <View style={styles.dualCol}>
          <View style={styles.dualHeader}>
            <Feather name="award" size={14} color="#10B981" style={{ marginRight: 6 }} />
            <Text style={styles.dualTitle}>HOW THEY BUILD TRUST (PROOF)</Text>
          </View>
          {proofStrategy.proofItems.map((pr, idx) => (
            <View key={idx} style={styles.miniCard}>
              <View style={styles.proofTagWrap}>
                <Text style={styles.proofTag}>{pr.typeLabel}</Text>
              </View>
              <Text style={styles.miniCardTitle}>{pr.statement}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* ── 9. WHAT CHANGED RECENTLY (WATCHTOWER) ── */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <Feather name="eye" size={16} color="#8B5CF6" style={{ marginRight: 8 }} />
          <Text style={styles.sectionTitle}>WHAT HAS CHANGED RECENTLY</Text>
          <View style={[styles.countPill, { backgroundColor: '#F59E0B20' }]}>
            <Text style={[styles.countPillText, { color: '#FBBF24' }]}>
              {whatChanged.totalCount > 0 ? `${whatChanged.totalCount} Shifts Observed` : 'No Recent Shifts'}
            </Text>
          </View>
        </View>

        {whatChanged.changes.length > 0 ? (
          <View style={styles.changesList}>
            {whatChanged.changes.map((ch) => (
              <View key={ch.eventId} style={styles.changeCard}>
                <View style={styles.changeCardHeader}>
                  <Text style={styles.changeTitle}>{ch.title}</Text>
                  <View style={styles.eventPill}>
                    <Text style={styles.eventPillText}>{ch.status}</Text>
                  </View>
                </View>
                <Text style={styles.changeDesc}>{ch.description}</Text>
                <Text style={styles.changeWhy}><Text style={{ fontWeight: '700' }}>Why it matters:</Text> {ch.whyItMatters}</Text>
                <Text style={styles.eventIdFoot}>Watchtower ID: {ch.eventId}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.noChangesText}>No meaningful strategic changes detected in recent observation cycles.</Text>
        )}
      </View>

      {/* ── 10. WHAT THIS TELLS US (STRATEGIC READ) ── */}
      <View style={styles.reasoningCard}>
        <View style={styles.sectionHeader}>
          <Feather name="zap" size={16} color="#8B5CF6" style={{ marginRight: 8 }} />
          <Text style={styles.sectionTitle}>WHAT THIS TELLS US (STRATEGIC READ)</Text>
        </View>
        <Text style={styles.strategicReadText}>{whatThisTellsUs.strategicRead}</Text>

        <View style={styles.whyAvyronBox}>
          <Text style={styles.subHeadLabel}>WHY AVYRON IDENTIFIED THIS PATTERN</Text>
          {whatThisTellsUs.whyAvyronThinksThis.map((pt, idx) => (
            <View key={idx} style={styles.whyBulletRow}>
              <Feather name="corner-down-right" size={13} color="#A78BFA" style={{ marginTop: 2, marginRight: 8 }} />
              <Text style={styles.whyBulletText}>{pt}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* ── 11. HOW THIS COMPARES TO YOU ── */}
      <View style={styles.comparisonCard}>
        <View style={styles.sectionHeader}>
          <Feather name="git-pull-request" size={16} color="#3B82F6" style={{ marginRight: 8 }} />
          <Text style={styles.sectionTitle}>HOW THIS COMPARES TO YOU</Text>
        </View>

        <View style={styles.comparisonGrid}>
          <View style={styles.compSide}>
            <Text style={styles.compSideLabel}>THEY EMPHASIZE</Text>
            <Text style={styles.compSideText}>{howThisComparesToYou.theyEmphasize}</Text>
          </View>

          <View style={styles.compSide}>
            <Text style={[styles.compSideLabel, { color: '#10B981' }]}>YOU ESTABLISH</Text>
            <Text style={styles.compSideText}>{howThisComparesToYou.youEstablish}</Text>
          </View>
        </View>

        <View style={styles.diffConclusionBox}>
          <Text style={styles.diffLabel}>THE STRATEGIC DIFFERENCE</Text>
          <Text style={styles.diffText}>{howThisComparesToYou.strategicDifference}</Text>
          <Text style={styles.epistemicFoot}>Note: {howThisComparesToYou.epistemicNote}</Text>
        </View>
      </View>

      {/* ── 12. WHAT TO WATCH & POSSIBLE OPENINGS ── */}
      <View style={styles.openingsGrid}>
        <View style={styles.openingCol}>
          <View style={styles.openingColHeader}>
            <Feather name="compass" size={15} color="#10B981" style={{ marginRight: 6 }} />
            <Text style={[styles.openingColTitle, { color: '#10B981' }]}>POSSIBLE OPENINGS</Text>
          </View>
          {opportunitiesAndThreats.possibleOpenings.map((po, idx) => (
            <View key={idx} style={styles.openingItem}>
              <Feather name="check" size={13} color="#10B981" style={{ marginTop: 3, marginRight: 8 }} />
              <Text style={styles.openingText}>{po}</Text>
            </View>
          ))}
        </View>

        <View style={styles.openingCol}>
          <View style={styles.openingColHeader}>
            <Feather name="alert-triangle" size={15} color="#F59E0B" style={{ marginRight: 6 }} />
            <Text style={[styles.openingColTitle, { color: '#F59E0B' }]}>WHAT TO WATCH</Text>
          </View>
          {opportunitiesAndThreats.whatToWatch.map((ww, idx) => (
            <View key={idx} style={styles.openingItem}>
              <Feather name="eye" size={13} color="#F59E0B" style={{ marginTop: 3, marginRight: 8 }} />
              <Text style={styles.openingText}>{ww}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* ── 13. EVIDENCE DOSSIER (EXPANDABLE) ── */}
      <View style={styles.accordionContainer}>
        <Pressable
          style={styles.accordionHeader}
          onPress={() => setShowEvidence(!showEvidence)}
        >
          <View style={styles.accordionLeft}>
            <Feather name="database" size={16} color="#9CA3AF" style={{ marginRight: 8 }} />
            <Text style={styles.accordionTitle}>Evidence Dossier & Source Proof</Text>
            <View style={styles.badgeMini}>
              <Text style={styles.badgeMiniText}>{evidenceDossier.totalCount} Sources</Text>
            </View>
          </View>
          <Feather name={showEvidence ? 'chevron-up' : 'chevron-down'} size={18} color="#9CA3AF" />
        </Pressable>

        {showEvidence && (
          <View style={styles.accordionBody}>
            <Text style={styles.evidenceIntro}>
              Raw crawled excerpts, website captures, and post data verifying this intelligence:
            </Text>
            {evidenceDossier.items.map((ev) => (
              <View key={ev.id} style={styles.evidenceCard}>
                <View style={styles.evHeader}>
                  <Text style={styles.evType}>{ev.sourceType.toUpperCase()}</Text>
                  {ev.sourceUrl ? <Text style={styles.evUrl} numberOfLines={1}>{ev.sourceUrl}</Text> : null}
                </View>
                <Text style={styles.evExcerpt}>"{ev.excerpt}"</Text>
                <Text style={styles.evContext}>{ev.context}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
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
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    alignSelf: 'flex-start',
  },
  backBtnText: {
    color: '#A78BFA',
    fontSize: 13,
    fontWeight: '600',
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
  freshnessBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#10B98115',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  greenDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
    marginRight: 6,
  },
  freshnessText: {
    color: '#10B981',
    fontSize: 11,
    fontWeight: '600',
  },
  compNameTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#FFFFFF',
    textTransform: 'capitalize',
    marginBottom: 8,
  },
  heroSummaryText: {
    fontSize: 15,
    color: '#D1D5DB',
    lineHeight: 22,
    marginBottom: 18,
  },
  heroMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#1F2937',
    gap: 12,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  metaLabel: {
    fontSize: 12,
    color: '#9CA3AF',
    marginRight: 4,
  },
  metaVal: {
    fontSize: 12,
    color: '#E5E7EB',
    fontWeight: '600',
  },
  metaDivider: {
    width: 1,
    height: 12,
    backgroundColor: '#374151',
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
    marginBottom: 6,
  },
  sectionHeaderBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
    flexWrap: 'wrap',
    gap: 8,
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
    marginBottom: 16,
  },
  sectionBodyText: {
    fontSize: 14,
    color: '#D1D5DB',
    lineHeight: 21,
    marginBottom: 16,
  },
  countPill: {
    backgroundColor: '#8B5CF620',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 8,
  },
  countPillText: {
    color: '#A78BFA',
    fontSize: 11,
    fontWeight: '700',
  },
  toggleViewBtn: {
    backgroundColor: '#1F2937',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#374151',
  },
  toggleViewText: {
    color: '#9CA3AF',
    fontSize: 11,
    fontWeight: '600',
  },
  jobsBox: {
    backgroundColor: '#11161F',
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1E2535',
  },
  subHeadLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#9CA3AF',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  bulletList: {
    gap: 8,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  bulletText: {
    fontSize: 13,
    color: '#E5E7EB',
    flex: 1,
    lineHeight: 18,
  },
  groupsContainer: {
    gap: 16,
  },
  groupCard: {
    backgroundColor: '#11161F',
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1E2535',
  },
  groupHeaderTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#A78BFA',
    marginBottom: 12,
  },
  groupItemsList: {
    gap: 10,
  },
  allCapsList: {
    gap: 10,
  },
  capItem: {
    backgroundColor: '#161B22',
    padding: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#1E2535',
  },
  capItemTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  capStatement: {
    fontSize: 13,
    color: '#FFFFFF',
    fontWeight: '600',
    flex: 1,
    lineHeight: 18,
  },
  statusMiniBadge: {
    backgroundColor: '#1F2937',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusMiniText: {
    color: '#9CA3AF',
    fontSize: 10,
    fontWeight: '600',
  },
  capRationale: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 6,
    lineHeight: 17,
  },
  rolesGrid: {
    flexDirection: 'row',
    gap: 12,
    flexWrap: 'wrap',
  },
  roleCard: {
    flex: 1,
    minWidth: 240,
    backgroundColor: '#11161F',
    borderRadius: 8,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1E2535',
  },
  roleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  roleTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  roleTypeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  buyerBadge: {
    backgroundColor: '#8B5CF620',
  },
  userBadge: {
    backgroundColor: '#3B82F620',
  },
  roleTypeText: {
    color: '#D1D5DB',
    fontSize: 10,
    fontWeight: '700',
  },
  roleStatus: {
    fontSize: 11,
    color: '#9CA3AF',
  },
  posPrimaryBox: {
    backgroundColor: '#11161F',
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1E2535',
    marginBottom: 16,
  },
  posBoxLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#9CA3AF',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  posBoxStatement: {
    fontSize: 15,
    fontStyle: 'italic',
    color: '#FFFFFF',
    lineHeight: 22,
  },
  mechanismsBox: {
    backgroundColor: '#11161F',
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1E2535',
  },
  mechItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  mechText: {
    fontSize: 13,
    color: '#D1D5DB',
    flex: 1,
    lineHeight: 18,
  },
  playbookContainer: {
    backgroundColor: '#11161F',
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1E2535',
  },
  playbookGrid: {
    flexDirection: 'row',
    gap: 12,
    flexWrap: 'wrap',
  },
  playbookStepCard: {
    flex: 1,
    minWidth: 200,
    backgroundColor: '#161B22',
    borderRadius: 6,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1E2535',
  },
  stepHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  stepTag: {
    backgroundColor: '#8B5CF620',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  stepTagText: {
    color: '#A78BFA',
    fontSize: 10,
    fontWeight: '800',
  },
  stepTacticBadge: {
    fontSize: 10,
    color: '#9CA3AF',
  },
  stepCardTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  stepCardDesc: {
    fontSize: 11,
    color: '#9CA3AF',
    lineHeight: 16,
  },
  recurringList: {
    gap: 10,
  },
  recurringCard: {
    backgroundColor: '#11161F',
    borderRadius: 8,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1E2535',
  },
  recurringHeader: {
    marginBottom: 8,
  },
  recurringIdeaText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    fontStyle: 'italic',
    lineHeight: 20,
  },
  recurringMetaRow: {
    gap: 4,
  },
  recurringMetaText: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  dualGrid: {
    flexDirection: 'row',
    gap: 16,
    flexWrap: 'wrap',
    marginBottom: 20,
  },
  dualCol: {
    flex: 1,
    minWidth: 300,
    backgroundColor: '#161B22',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E2535',
    padding: 20,
  },
  dualHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  dualTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  miniCard: {
    backgroundColor: '#11161F',
    borderRadius: 6,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1E2535',
    marginBottom: 8,
  },
  miniCardTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#E5E7EB',
    marginBottom: 2,
  },
  miniCardDesc: {
    fontSize: 11,
    color: '#9CA3AF',
  },
  proofTagWrap: {
    marginBottom: 4,
  },
  proofTag: {
    fontSize: 10,
    fontWeight: '700',
    color: '#10B981',
  },
  changesList: {
    gap: 10,
  },
  changeCard: {
    backgroundColor: '#11161F',
    borderRadius: 8,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1E2535',
  },
  changeCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  changeTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  eventPill: {
    backgroundColor: '#F59E0B20',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  eventPillText: {
    color: '#FBBF24',
    fontSize: 10,
    fontWeight: '700',
  },
  changeDesc: {
    fontSize: 12,
    color: '#D1D5DB',
    lineHeight: 17,
    marginBottom: 6,
  },
  changeWhy: {
    fontSize: 12,
    color: '#9CA3AF',
    lineHeight: 17,
    marginBottom: 6,
  },
  eventIdFoot: {
    fontSize: 10,
    color: '#6B7280',
  },
  noChangesText: {
    fontSize: 13,
    color: '#9CA3AF',
    fontStyle: 'italic',
  },
  reasoningCard: {
    backgroundColor: '#161B22',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#8B5CF640',
    padding: 24,
    marginBottom: 20,
  },
  strategicReadText: {
    fontSize: 15,
    color: '#FFFFFF',
    lineHeight: 22,
    fontWeight: '500',
    marginBottom: 16,
  },
  whyAvyronBox: {
    backgroundColor: '#11161F',
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1E2535',
  },
  whyBulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  whyBulletText: {
    fontSize: 13,
    color: '#D1D5DB',
    flex: 1,
    lineHeight: 18,
  },
  comparisonCard: {
    backgroundColor: '#161B22',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E2535',
    padding: 24,
    marginBottom: 20,
  },
  comparisonGrid: {
    flexDirection: 'row',
    gap: 16,
    flexWrap: 'wrap',
    marginBottom: 16,
  },
  compSide: {
    flex: 1,
    minWidth: 260,
    backgroundColor: '#11161F',
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1E2535',
  },
  compSideLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#9CA3AF',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  compSideText: {
    fontSize: 13,
    color: '#E5E7EB',
    lineHeight: 19,
  },
  diffConclusionBox: {
    backgroundColor: '#11161F',
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1E2535',
  },
  diffLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#8B5CF6',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  diffText: {
    fontSize: 13,
    color: '#FFFFFF',
    fontWeight: '500',
    lineHeight: 19,
    marginBottom: 8,
  },
  epistemicFoot: {
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
    minWidth: 300,
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
  accordionContainer: {
    backgroundColor: '#161B22',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E2535',
    marginBottom: 20,
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
  evidenceIntro: {
    fontSize: 13,
    color: '#9CA3AF',
    marginVertical: 12,
  },
  evidenceCard: {
    backgroundColor: '#11161F',
    padding: 12,
    borderRadius: 6,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1E2535',
  },
  evHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  evType: {
    fontSize: 10,
    fontWeight: '800',
    color: '#8B5CF6',
  },
  evUrl: {
    fontSize: 11,
    color: '#6B7280',
    maxWidth: 300,
  },
  evExcerpt: {
    fontSize: 12,
    color: '#E5E7EB',
    fontStyle: 'italic',
    marginBottom: 4,
  },
  evContext: {
    fontSize: 11,
    color: '#9CA3AF',
  },
});
