import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
} from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import type { BuyerConversionJourneyItem } from '@/types/buyer-conversion-journey';
import {
  translateJourneyType,
  translatePersuasionPrinciple,
  translateEntryTrigger,
  translateMessageStepLabel,
} from './bll-presenter';

interface Props {
  journeys?: BuyerConversionJourneyItem[];
  // Legacy singletons for fallback normalization
  legacyJourney?: any;
  legacyPersuasion?: any;
  // Strategic root context for pain lookups if needed
  approvedLanes?: any[];
  pains?: any[];
}

export default function BuyerConversionJourneyView({
  journeys,
  legacyJourney,
  legacyPersuasion,
  approvedLanes,
  pains,
}: Props) {
  // ── Normalize Data Source: buyerConversionJourneys[] is primary canonical ──
  const normalizedJourneys: BuyerConversionJourneyItem[] = React.useMemo(() => {
    if (Array.isArray(journeys) && journeys.length > 0) {
      return journeys;
    }
    // Fallback normalization for legacy singletons
    if (legacyJourney || legacyPersuasion) {
      const stages = Array.isArray(legacyJourney?.stages)
        ? legacyJourney.stages.map((s: any) => ({
            stageId: s.stageId || s.id || (s.stageName || s.name || "stage").toLowerCase().replace(/\s+/g, "_"),
            stageName: s.stageName || s.name || "Funnel Stage",
            goal: s.goal || s.conversionGoal || "",
            buyerState: s.buyerState || "",
            coreMessage: s.coreMessage || s.message || "",
            contentAction: s.contentAction || s.action || "",
            proof: Array.isArray(s.proof) ? s.proof : (s.proofPlacements || []),
            cta: s.cta || s.callToAction || "",
          }))
        : [];

      const normLegacy: BuyerConversionJourneyItem = {
        laneId: legacyJourney?.laneId || "default_lane",
        laneLabel: legacyJourney?.laneLabel || legacyJourney?.journeyName || "Buyer Conversion Journey",
        primaryPainId: legacyJourney?.primaryPainId,
        primaryPainText: legacyJourney?.primaryPainText,
        segmentIds: legacyJourney?.segmentIds || [],
        targetSegmentName: legacyJourney?.targetSegmentName,
        journeyName: legacyJourney?.journeyName || "Buyer Conversion Journey",
        journeyType: legacyJourney?.journeyType || "Consultative B2B",
        whyThisJourney: legacyJourney?.whyThisJourney || "Strategic conversion flow aligned to buyer decision criteria.",
        entryTrigger: legacyJourney?.entryTrigger || {
          mechanismType: "Primary Problem Agitation",
          purpose: "Capture qualified buyer attention and establish initial category relevance.",
        },
        stages,
        persuasionStrategy: legacyJourney?.persuasionStrategy || legacyPersuasion || undefined,
      };
      return [normLegacy];
    }
    return [];
  }, [journeys, legacyJourney, legacyPersuasion]);

  // Selected Lane Identity bound by laneId (NEVER by array index)
  const initialLaneId = normalizedJourneys[0]?.laneId || "lane_0";
  const [selectedJourneyLaneId, setSelectedJourneyLaneId] = useState<string>(initialLaneId);
  const [showLineage, setShowLineage] = useState<boolean>(false);

  if (normalizedJourneys.length === 0) {
    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Feather name="git-branch" size={16} color="#8B5CF6" style={{ marginRight: 8 }} />
          <Text style={styles.sectionTitle}>BUYER CONVERSION JOURNEY</Text>
        </View>
        <View style={styles.emptyState}>
          <Feather name="clock" size={24} color="#64748B" style={{ marginBottom: 8 }} />
          <Text style={styles.emptyText}>Conversion journey is being computed for this audience.</Text>
        </View>
      </View>
    );
  }

  // Resolve active journey by laneId
  const activeJourney =
    normalizedJourneys.find((j) => (j.laneId || "lane_0") === selectedJourneyLaneId) ||
    normalizedJourneys[0];

  // Lookup pain text if missing from journey
  const primaryPainText =
    activeJourney.primaryPainText ||
    pains?.find((p: any) => (p.painId || p.id) === activeJourney.primaryPainId)?.text ||
    approvedLanes?.find((l: any) => (l.laneId || l.id) === activeJourney.laneId)?.description ||
    approvedLanes?.find((l: any) => (l.laneId || l.id) === activeJourney.laneId)?.title ||
    "Core commercial problem addressed by this strategic lane.";

  const targetSegmentLabel =
    activeJourney.targetSegmentName ||
    activeJourney.laneLabel ||
    `Audience Lane ${activeJourney.laneId || ""}`;

  const persuasion = activeJourney.persuasionStrategy;

  // Build stage ID lookup map for exact objection linkage
  const stageNameById = new Map<string, string>();
  activeJourney.stages.forEach((s) => {
    if (s.stageId) stageNameById.set(s.stageId, s.stageName);
  });

  return (
    <View style={styles.card}>
      {/* ── SECTION HEADER & MULTI-LANE TABS ── */}
      <View style={styles.headerBlock}>
        <View style={styles.headerTopRow}>
          <View style={styles.badgePrimary}>
            <Feather name="git-branch" size={12} color="#8B5CF6" style={{ marginRight: 6 }} />
            <Text style={styles.badgePrimaryText}>BUYER CONVERSION JOURNEY</Text>
          </View>
          <View style={styles.laneCountBadge}>
            <Text style={styles.laneCountText}>
              {normalizedJourneys.length > 1
                ? `${normalizedJourneys.length} Strategic Lanes`
                : `${activeJourney.stages.length} Connected Stages`}
            </Text>
          </View>
        </View>

        {/* Multi-Lane Selector (Rendered ONLY when > 1 journey exists) */}
        {normalizedJourneys.length > 1 && (
          <View style={styles.laneTabContainer}>
            {normalizedJourneys.map((j, idx) => {
              const jLaneId = j.laneId || `lane_${idx}`;
              const isSelected = jLaneId === (activeJourney.laneId || "lane_0");
              const label = j.laneLabel || j.journeyName || `Lane ${idx + 1}`;
              return (
                <Pressable
                  key={jLaneId}
                  onPress={() => setSelectedJourneyLaneId(jLaneId)}
                  style={[styles.laneTab, isSelected && styles.laneTabSelected]}
                >
                  <Text style={[styles.laneTabText, isSelected && styles.laneTabTextSelected]}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>

      {/* ── SECTION 1: JOURNEY HERO ── */}
      <View style={styles.heroSection}>
        <View style={styles.heroTargetRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroSubLabel}>TARGET BUYER & STRATEGIC LANE</Text>
            <Text style={styles.heroTitle}>{targetSegmentLabel}</Text>
          </View>
          <View style={styles.journeyTypeBadge}>
            <Text style={styles.journeyTypeText}>{translateJourneyType(activeJourney.journeyType)}</Text>
          </View>
        </View>

        {/* Core Buying Problem */}
        <View style={styles.problemBox}>
          <Text style={styles.problemLabel}>CORE BUYING PROBLEM</Text>
          <Text style={styles.problemText}>{primaryPainText}</Text>
        </View>

        {/* Recommended Path & Entry Strategy */}
        <View style={styles.metaGrid}>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>RECOMMENDED CONVERSION PATH</Text>
            <Text style={styles.metaValue}>{activeJourney.journeyName}</Text>
          </View>
          {activeJourney.entryTrigger && (
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>ENTRY STRATEGY</Text>
              <Text style={styles.metaValue}>
                {translateEntryTrigger(activeJourney.entryTrigger.mechanismType)} — {activeJourney.entryTrigger.purpose}
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* ── SECTION 2: WHY THIS JOURNEY (EDITORIAL NOTE) ── */}
      {activeJourney.whyThisJourney && (
        <View style={styles.editorialNoteCard}>
          <View style={styles.editorialHeader}>
            <Feather name="compass" size={14} color="#A78BFA" style={{ marginRight: 6 }} />
            <Text style={styles.editorialLabel}>WHY THIS CONVERSION PATH</Text>
          </View>
          <Text style={styles.editorialText}>{activeJourney.whyThisJourney}</Text>
        </View>
      )}

      {/* ── SECTION 3: VISUAL BUYER JOURNEY (CONNECTED STAGES) ── */}
      <View style={styles.stagesSection}>
        <View style={styles.sectionHeadingRow}>
          <Feather name="layers" size={15} color="#3B82F6" style={{ marginRight: 8 }} />
          <Text style={styles.subSectionTitle}>THE BUYER JOURNEY</Text>
        </View>
        <Text style={styles.sectionSubtitle}>
          Step-by-step commercial progression moving this buyer from initial perception to conversion.
        </Text>

        <View style={styles.stageTimeline}>
          {activeJourney.stages.map((stage, sIdx) => {
            const isLast = sIdx === activeJourney.stages.length - 1;
            const stageNum = String(sIdx + 1).padStart(2, '0');

            // Find objections mapped directly to this stage via funnelStageId
            const mappedObjections = (persuasion?.objections || []).filter(
              (o) => o.funnelStageId && (o.funnelStageId === stage.stageId || o.funnelStageId === String(sIdx + 1))
            );

            return (
              <View key={stage.stageId || sIdx} style={styles.stageStepRow}>
                {/* Left Step Column with Vertical Connector */}
                <View style={styles.timelineLeftCol}>
                  <View style={styles.stageNumCircle}>
                    <Text style={styles.stageNumText}>{stageNum}</Text>
                  </View>
                  {!isLast && <View style={styles.timelineConnectorLine} />}
                </View>

                {/* Stage Content Card */}
                <View style={styles.stageCard}>
                  {/* Header Row: Stage Name + Buyer State */}
                  <View style={styles.stageCardHeader}>
                    <Text style={styles.stageNameText}>{stage.stageName}</Text>
                    {stage.buyerState && (
                      <View style={styles.buyerStateChip}>
                        <Text style={styles.buyerStateText}>{stage.buyerState}</Text>
                      </View>
                    )}
                  </View>

                  {/* Goal */}
                  {stage.goal && (
                    <View style={styles.stageFieldRow}>
                      <Text style={styles.stageFieldLabel}>GOAL</Text>
                      <Text style={styles.stageGoalText}>{stage.goal}</Text>
                    </View>
                  )}

                  {/* Core Message */}
                  {stage.coreMessage && (
                    <View style={styles.stageFieldRow}>
                      <Text style={styles.stageFieldLabel}>CORE MESSAGE</Text>
                      <Text style={styles.stageMessageText}>"{stage.coreMessage}"</Text>
                    </View>
                  )}

                  {/* What We Do / Action */}
                  {stage.contentAction && (
                    <View style={styles.stageFieldRow}>
                      <Text style={styles.stageFieldLabel}>WHAT WE DO</Text>
                      <Text style={styles.stageActionText}>{stage.contentAction}</Text>
                    </View>
                  )}

                  {/* Proof Placements */}
                  {Array.isArray(stage.proof) && stage.proof.length > 0 && (
                    <View style={styles.stageFieldRow}>
                      <Text style={styles.stageFieldLabel}>PROOF REQUIRED</Text>
                      <View style={styles.proofChipRow}>
                        {stage.proof.map((p, pIdx) => (
                          <View key={pIdx} style={styles.proofChip}>
                            <Feather name="check-circle" size={10} color="#14B8A6" style={{ marginRight: 4 }} />
                            <Text style={styles.proofChipText}>
                              {typeof p === 'string' ? p : (p as any).proofName || (p as any).claim || JSON.stringify(p)}
                            </Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  )}

                  {/* CTA */}
                  {stage.cta && (
                    <View style={styles.stageCtaRow}>
                      <Feather name="arrow-right-circle" size={13} color="#10B981" style={{ marginRight: 6 }} />
                      <Text style={styles.stageCtaLabel}>CALL TO ACTION: </Text>
                      <Text style={styles.stageCtaValue}>{stage.cta}</Text>
                    </View>
                  )}

                  {/* Stage-Linked Objection Callout */}
                  {mappedObjections.length > 0 && (
                    <View style={styles.stageObjectionCallout}>
                      <Feather name="alert-triangle" size={11} color="#F59E0B" style={{ marginRight: 5 }} />
                      <Text style={styles.stageObjectionText}>
                        <Text style={{ fontWeight: '700' }}>Pre-empts Objection: </Text>
                        "{mappedObjections[0].objection}"
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      </View>

      {/* ── SECTION 4: THE BELIEF SHIFT (PERSUASION INSIDE JOURNEY) ── */}
      {persuasion && persuasion.coreBeliefTransformation && (
        <View style={styles.beliefShiftSection}>
          <View style={styles.sectionHeadingRow}>
            <Feather name="zap" size={15} color="#8B5CF6" style={{ marginRight: 8 }} />
            <Text style={styles.subSectionTitle}>THE BELIEF SHIFT</Text>
            <View style={styles.modeBadge}>
              <Text style={styles.modeBadgeText}>{persuasion.modeLabel || persuasion.mode}</Text>
            </View>
          </View>
          <Text style={styles.sectionSubtitle}>
            What this buyer currently assumes vs. what they must believe before commercial commitment.
          </Text>

          <View style={styles.beliefGrid}>
            <View style={styles.beliefCardCurrent}>
              <Text style={styles.beliefCardLabelCurrent}>CURRENT ASSUMPTION</Text>
              <Text style={styles.beliefTextCurrent}>
                "{persuasion.coreBeliefTransformation.currentBelief}"
              </Text>
            </View>

            <View style={styles.beliefArrowWrap}>
              <Feather name="arrow-down" size={18} color="#8B5CF6" />
            </View>

            <View style={styles.beliefCardDesired}>
              <Text style={styles.beliefCardLabelDesired}>BELIEF WE MUST CREATE</Text>
              <Text style={styles.beliefTextDesired}>
                "{persuasion.coreBeliefTransformation.desiredBelief}"
              </Text>
              {persuasion.coreBeliefTransformation.contradictionLogic && (
                <View style={styles.contradictionBox}>
                  <Text style={styles.contradictionText}>
                    <Text style={{ fontWeight: '700' }}>Strategic Logic: </Text>
                    {persuasion.coreBeliefTransformation.contradictionLogic}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>
      )}

      {/* ── SECTION 5: MESSAGE PROGRESSION ── */}
      {persuasion && Array.isArray(persuasion.messageSequence) && persuasion.messageSequence.length > 0 && (
        <View style={styles.messageSequenceSection}>
          <View style={styles.sectionHeadingRow}>
            <Feather name="trending-up" size={15} color="#10B981" style={{ marginRight: 8 }} />
            <Text style={styles.subSectionTitle}>STRATEGIC MESSAGE PROGRESSION</Text>
          </View>
          <Text style={styles.sectionSubtitle}>
            The persuasive logic sequence that systematically guides the buyer's thinking.
          </Text>

          <View style={styles.messageStepList}>
            {persuasion.messageSequence.map((m, mIdx) => (
              <View key={m.step || mIdx} style={styles.messageStepCard}>
                <View style={styles.messageStepNum}>
                  <Text style={styles.messageStepNumText}>{mIdx + 1}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.messageStepTitle}>
                    {translateMessageStepLabel(m.stepLabel, mIdx)}
                  </Text>
                  {m.rationale ? (
                    <Text style={styles.messageStepRationale}>{m.rationale}</Text>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* ── SECTION 6: OBJECTION & PROOF PLAYBOOK ── */}
      {persuasion && Array.isArray(persuasion.objections) && persuasion.objections.length > 0 && (
        <View style={styles.objectionSection}>
          <View style={styles.sectionHeadingRow}>
            <Feather name="shield" size={15} color="#F59E0B" style={{ marginRight: 8 }} />
            <Text style={styles.subSectionTitle}>OBJECTION & PROOF PLAYBOOK</Text>
          </View>
          <Text style={styles.sectionSubtitle}>
            Pre-empting key commercial hesitation with authoritative messaging and verifiable evidence.
          </Text>

          <View style={styles.objectionList}>
            {persuasion.objections.map((obj, oIdx) => {
              const handledInStageName = obj.funnelStageId ? stageNameById.get(obj.funnelStageId) : undefined;
              return (
                <View key={obj.objectionId || oIdx} style={styles.objectionCard}>
                  {/* Barrier */}
                  <View style={styles.objectionRow}>
                    <Text style={styles.objectionLabel}>BARRIER / SKEPTICISM</Text>
                    <Text style={styles.objectionText}>"{obj.objection}"</Text>
                  </View>

                  {/* Response */}
                  <View style={styles.responseRow}>
                    <Text style={styles.responseLabel}>STRATEGIC RESPONSE</Text>
                    <Text style={styles.responseText}>{obj.response}</Text>
                  </View>

                  {/* Proof */}
                  {obj.requiredProof && (
                    <View style={styles.proofRow}>
                      <Text style={styles.proofLabel}>REQUIRED PROOF</Text>
                      <View style={styles.proofRequiredBadge}>
                        <Feather name="file-text" size={11} color="#14B8A6" style={{ marginRight: 5 }} />
                        <Text style={styles.proofRequiredText}>{obj.requiredProof}</Text>
                      </View>
                    </View>
                  )}

                  {/* Stage Resolution */}
                  {handledInStageName && (
                    <View style={styles.stageResolutionTag}>
                      <Feather name="check" size={10} color="#8B5CF6" style={{ marginRight: 4 }} />
                      <Text style={styles.stageResolutionText}>
                        Handled in: <Text style={{ fontWeight: '700' }}>{handledInStageName}</Text>
                      </Text>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        </View>
      )}

      {/* ── SECTION 7: HOW WE EARN TRUST (TRUST STRATEGY) ── */}
      {persuasion && persuasion.trustStrategy && (
        <View style={styles.trustSection}>
          <View style={styles.sectionHeadingRow}>
            <Feather name="lock" size={15} color="#14B8A6" style={{ marginRight: 8 }} />
            <Text style={styles.subSectionTitle}>HOW WE EARN TRUST</Text>
          </View>
          <Text style={styles.sectionSubtitle}>
            De-risking the buyer's procurement hesitation through verifiable proof mechanisms.
          </Text>

          <View style={styles.trustGrid}>
            <View style={styles.trustItem}>
              <Text style={styles.trustItemLabel}>BUYER RISK STATE</Text>
              <Text style={styles.trustItemValue}>{persuasion.trustStrategy.buyerRiskState}</Text>
            </View>
            <View style={styles.trustItem}>
              <Text style={styles.trustItemLabel}>TRUST GAP</Text>
              <Text style={styles.trustItemValue}>{persuasion.trustStrategy.trustDeficit}</Text>
            </View>
            <View style={styles.trustItem}>
              <Text style={styles.trustItemLabel}>TRUST MECHANISM</Text>
              <Text style={styles.trustItemValue}>{persuasion.trustStrategy.transferMechanismName}</Text>
            </View>
            <View style={styles.trustItem}>
              <Text style={styles.trustItemLabel}>PROOF ARTIFACT</Text>
              <Text style={styles.trustItemValue}>{persuasion.trustStrategy.proofArtifact}</Text>
            </View>
          </View>

          {persuasion.trustStrategy.primaryCialdiniPrinciple && (
            <View style={styles.credibilityCard}>
              <Text style={styles.credibilityLabel}>CREDIBILITY STRATEGY</Text>
              <Text style={styles.credibilityPrinciple}>
                {translatePersuasionPrinciple(persuasion.trustStrategy.primaryCialdiniPrinciple)}
              </Text>
              {persuasion.trustStrategy.principleRationale && (
                <Text style={styles.credibilityRationale}>
                  {persuasion.trustStrategy.principleRationale}
                </Text>
              )}
            </View>
          )}
        </View>
      )}

      {/* ── LINEAGE / INTEGRITY ACCORDION (DEVELOPER/AUDIT) ── */}
      <View style={styles.lineageFooter}>
        <Pressable onPress={() => setShowLineage(!showLineage)} style={styles.lineageToggleBtn}>
          <Feather name="cpu" size={12} color="#64748B" style={{ marginRight: 6 }} />
          <Text style={styles.lineageToggleText}>
            {showLineage ? "Hide Lineage Evidence" : "View Lineage & Snapshot Evidence"}
          </Text>
          <Feather name={showLineage ? "chevron-up" : "chevron-down"} size={12} color="#64748B" style={{ marginLeft: 4 }} />
        </Pressable>

        {showLineage && (
          <View style={styles.lineageDrawer}>
            <Text style={styles.lineageRow}><Text style={styles.lineageKey}>Lane ID: </Text>{activeJourney.laneId || "N/A"}</Text>
            <Text style={styles.lineageRow}><Text style={styles.lineageKey}>Primary Pain ID: </Text>{activeJourney.primaryPainId || "N/A"}</Text>
            <Text style={styles.lineageRow}><Text style={styles.lineageKey}>Funnel Snapshot: </Text>{activeJourney.sourceFunnelSnapshotId || "N/A"}</Text>
            <Text style={styles.lineageRow}><Text style={styles.lineageKey}>Persuasion Snapshot: </Text>{activeJourney.sourcePersuasionSnapshotId || "N/A"}</Text>
            <Text style={styles.lineageRow}><Text style={styles.lineageKey}>Segment IDs: </Text>{(activeJourney.segmentIds || []).join(", ") || "N/A"}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#0F1419',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1F2937',
    marginBottom: 16,
    overflow: 'hidden',
  },
  headerBlock: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1F2937',
    backgroundColor: '#111827',
  },
  headerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  badgePrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#8B5CF615',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#8B5CF630',
  },
  badgePrimaryText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#A78BFA',
    letterSpacing: 0.5,
  },
  laneCountBadge: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  laneCountText: {
    fontSize: 10,
    color: '#94A3B8',
    fontWeight: '600',
  },
  laneTabContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#1F2937',
  },
  laneTab: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
  },
  laneTabSelected: {
    backgroundColor: '#8B5CF6',
    borderColor: '#A78BFA',
  },
  laneTabText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94A3B8',
  },
  laneTabTextSelected: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  heroSection: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1F2937',
  },
  heroTargetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  heroSubLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#8B5CF6',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  heroTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#F8FAFC',
    letterSpacing: -0.3,
  },
  journeyTypeBadge: {
    backgroundColor: '#3B82F615',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#3B82F630',
  },
  journeyTypeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#60A5FA',
  },
  problemBox: {
    backgroundColor: '#1E1B4B40',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#8B5CF630',
    marginBottom: 12,
  },
  problemLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#A78BFA',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  problemText: {
    fontSize: 13,
    color: '#E2E8F0',
    lineHeight: 18,
    fontWeight: '500',
  },
  metaGrid: {
    gap: 8,
  },
  metaItem: {
    backgroundColor: '#1E293B40',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#33415550',
  },
  metaLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#64748B',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  metaValue: {
    fontSize: 12,
    fontWeight: '600',
    color: '#F1F5F9',
  },
  editorialNoteCard: {
    margin: 16,
    marginBottom: 0,
    padding: 14,
    backgroundColor: '#1E293B30',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#33415580',
  },
  editorialHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  editorialLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#A78BFA',
    letterSpacing: 0.5,
  },
  editorialText: {
    fontSize: 12,
    color: '#94A3B8',
    lineHeight: 18,
    fontStyle: 'italic',
  },
  stagesSection: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1F2937',
  },
  sectionHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  subSectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#F8FAFC',
    letterSpacing: 0.5,
  },
  sectionSubtitle: {
    fontSize: 11,
    color: '#64748B',
    marginBottom: 14,
  },
  stageTimeline: {
    marginTop: 6,
  },
  stageStepRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  timelineLeftCol: {
    alignItems: 'center',
    width: 32,
    marginRight: 10,
  },
  stageNumCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#3B82F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  stageNumText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#60A5FA',
  },
  timelineConnectorLine: {
    width: 2,
    flex: 1,
    backgroundColor: '#334155',
    marginVertical: 4,
  },
  stageCard: {
    flex: 1,
    backgroundColor: '#1E293B50',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 12,
  },
  stageCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  stageNameText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#F1F5F9',
  },
  buyerStateChip: {
    backgroundColor: '#8B5CF620',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#8B5CF640',
  },
  buyerStateText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#C4B5FD',
  },
  stageFieldRow: {
    marginBottom: 8,
  },
  stageFieldLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  stageGoalText: {
    fontSize: 12,
    color: '#CBD5E1',
    fontWeight: '500',
  },
  stageMessageText: {
    fontSize: 12,
    color: '#93C5FD',
    fontStyle: 'italic',
    lineHeight: 16,
  },
  stageActionText: {
    fontSize: 12,
    color: '#CBD5E1',
  },
  proofChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  proofChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#14B8A615',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#14B8A630',
  },
  proofChipText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#2DD4BF',
  },
  stageCtaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#064E3B30',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#10B98140',
    marginTop: 4,
  },
  stageCtaLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#34D399',
    letterSpacing: 0.3,
  },
  stageCtaValue: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6EE7B7',
    flex: 1,
  },
  stageObjectionCallout: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#451A0340',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#F59E0B40',
    marginTop: 8,
  },
  stageObjectionText: {
    fontSize: 10,
    color: '#FCD34D',
    flex: 1,
  },
  beliefShiftSection: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1F2937',
  },
  modeBadge: {
    backgroundColor: '#8B5CF620',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 'auto',
    borderWidth: 1,
    borderColor: '#8B5CF640',
  },
  modeBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#A78BFA',
  },
  beliefGrid: {
    gap: 8,
  },
  beliefCardCurrent: {
    backgroundColor: '#1E293B60',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#475569',
  },
  beliefCardLabelCurrent: {
    fontSize: 9,
    fontWeight: '800',
    color: '#94A3B8',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  beliefTextCurrent: {
    fontSize: 12,
    color: '#CBD5E1',
    lineHeight: 18,
    fontStyle: 'italic',
  },
  beliefArrowWrap: {
    alignItems: 'center',
    marginVertical: -2,
  },
  beliefCardDesired: {
    backgroundColor: '#1E1B4B60',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#8B5CF6',
  },
  beliefCardLabelDesired: {
    fontSize: 9,
    fontWeight: '800',
    color: '#A78BFA',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  beliefTextDesired: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F8FAFC',
    lineHeight: 18,
  },
  contradictionBox: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#8B5CF640',
  },
  contradictionText: {
    fontSize: 11,
    color: '#C4B5FD',
    lineHeight: 16,
  },
  messageSequenceSection: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1F2937',
  },
  messageStepList: {
    gap: 8,
  },
  messageStepCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#1E293B40',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  messageStepNum: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#10B98120',
    borderWidth: 1,
    borderColor: '#10B98150',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
    marginTop: 1,
  },
  messageStepNumText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#34D399',
  },
  messageStepTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#F1F5F9',
    marginBottom: 2,
  },
  messageStepRationale: {
    fontSize: 11,
    color: '#94A3B8',
    lineHeight: 16,
  },
  objectionSection: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1F2937',
  },
  objectionList: {
    gap: 10,
  },
  objectionCard: {
    backgroundColor: '#1E293B50',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 12,
  },
  objectionRow: {
    marginBottom: 6,
  },
  objectionLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#F59E0B',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  objectionText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FEF3C7',
  },
  responseRow: {
    marginBottom: 6,
  },
  responseLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#64748B',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  responseText: {
    fontSize: 12,
    color: '#CBD5E1',
    lineHeight: 16,
  },
  proofRow: {
    marginTop: 2,
  },
  proofLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#14B8A6',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  proofRequiredBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#14B8A615',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#14B8A630',
    alignSelf: 'flex-start',
  },
  proofRequiredText: {
    fontSize: 11,
    color: '#2DD4BF',
    fontWeight: '600',
  },
  stageResolutionTag: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#33415560',
  },
  stageResolutionText: {
    fontSize: 10,
    color: '#A78BFA',
  },
  trustSection: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1F2937',
  },
  trustGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  trustItem: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#1E293B40',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  trustItemLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#14B8A6',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  trustItemValue: {
    fontSize: 12,
    fontWeight: '600',
    color: '#F1F5F9',
  },
  credibilityCard: {
    backgroundColor: '#0F172A',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#14B8A640',
  },
  credibilityLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#2DD4BF',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  credibilityPrinciple: {
    fontSize: 13,
    fontWeight: '700',
    color: '#F8FAFC',
    marginBottom: 2,
  },
  credibilityRationale: {
    fontSize: 11,
    color: '#94A3B8',
    lineHeight: 16,
  },
  lineageFooter: {
    padding: 12,
    backgroundColor: '#0B0F17',
  },
  lineageToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
  },
  lineageToggleText: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  lineageDrawer: {
    marginTop: 8,
    padding: 10,
    backgroundColor: '#0F172A',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  lineageRow: {
    fontSize: 10,
    color: '#94A3B8',
    marginBottom: 3,
    fontFamily: 'monospace',
  },
  lineageKey: {
    color: '#64748B',
    fontWeight: '700',
  },
  emptyState: {
    padding: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1F2937',
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#F8FAFC',
    letterSpacing: 0.5,
  },
});
