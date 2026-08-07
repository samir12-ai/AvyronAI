import { eq, and, desc, ne, lt } from "drizzle-orm";
import { db } from "../db";
import {
  pipelineChangeEvents,
  pipelineSnapshots,
  strategicPlans,
  strategyRoots,
  buildPlanSnapshots,
  miSnapshots,
  audienceSnapshots,
  positioningSnapshots,
  ciCompetitors,
  ciCompetitorPosts,
  contentDna,
  competitorPostClassifications,
  performanceCycleReports,
  performanceDecisionVerdicts,
  weeklyBusinessScores,
  userChannelSnapshots,
  businessDataLayer,
  goalDecompositions,
  ciCompetitorMetricsSnapshot,
  pipelineDna
} from "../../shared/schema";

export interface EvidenceRegistryEntry {
  ref: string; // e.g. "EV-1", "BIZ-1", "GOAL-1", "COMP-1", "PERF-1", "HIST-1"
  origin: string; // e.g. "Watchtower", "Strategy Plan", "Audience Engine", etc.
  timestamp: string;
  engine: string;
  table: string;
  recordId: string | null;
  factType: "observed" | "calculated" | "inferred";
  age: string;
  freshnessStatus: string;
  confidence: string | null;
  relevanceScore: number;
  inclusionReason: string;
  detail: string;
  label: string;
}

export interface ContextLineageItem {
  recordId: string;
  table: string;
  engine: string;
  verdict: "included" | "excluded";
  exclusionReason: string | null;
  relevanceScore: number;
  freshnessState: string;
  tokenCostEstimate: number;
}

export interface ContextPayload {
  evidenceRegistry: EvidenceRegistryEntry[];
  contextLineage: ContextLineageItem[];
  sourceVersions: Record<string, string>;
  contextFingerprint: string;
}

// Simple deterministic token estimation
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Format relative freshness string
function getFreshnessState(date: Date): { age: string; status: string } {
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return { age: "0m", status: "fresh" };
  if (mins < 60) return { age: `${mins}m`, status: "fresh" };
  const hours = Math.floor(mins / 60);
  if (hours < 24) return { age: `${hours}h`, status: "fresh" };
  const days = Math.floor(hours / 24);
  if (days < 7) return { age: `${days}d`, status: "current" };
  if (days < 30) return { age: `${days}d`, status: "stale" };
  return { age: `${days}d`, status: "historical" };
}

export async function buildStrategicContext(
  eventId: string,
  campaignId: string,
  accountId: string
): Promise<ContextPayload> {
  const contextLineage: ContextLineageItem[] = [];
  const sourceVersions: Record<string, string> = {};
  const rawCandidates: EvidenceRegistryEntry[] = [];

  // Helper to log candidate inspected
  const logCandidate = (
    entry: EvidenceRegistryEntry,
    relevanceScore: number,
    verdict: "included" | "excluded",
    reason: string | null = null
  ) => {
    rawCandidates.push(entry);
    contextLineage.push({
      recordId: entry.recordId || "n/a",
      table: entry.table,
      engine: entry.engine,
      verdict,
      exclusionReason: reason,
      relevanceScore,
      freshnessState: entry.freshnessStatus,
      tokenCostEstimate: estimateTokens(entry.detail),
    });
  };

  // 1. Confirmed Watchtower Event
  const [eventRow] = await db
    .select()
    .from(pipelineChangeEvents)
    .where(
      and(
        eq(pipelineChangeEvents.id, eventId),
        eq(pipelineChangeEvents.accountId, accountId),
        eq(pipelineChangeEvents.campaignId, campaignId)
      )
    )
    .limit(1);

  if (!eventRow) {
    throw new Error(`Event ${eventId} not found or tenant mismatch`);
  }

  if (eventRow.status !== "confirmed") {
    throw new Error(`Event ${eventId} must be in confirmed state to interpret`);
  }

  sourceVersions.pipelineChangeEventId = eventRow.id;
  sourceVersions.pipelineChangeEventUpdatedAt = eventRow.updatedAt?.toISOString() || "";

  const eventFresh = getFreshnessState(eventRow.createdAt || new Date());
  const eventDetail = `Confirmed Watchtower event of kind "${eventRow.kind}" detected for competitor "${eventRow.competitorId}". Severity: "${eventRow.severity}", Scope: "${eventRow.scope}", destination value: "${eventRow.toValue || "unknown"}". Raw evidence: ${eventRow.evidence || "none"}`;
  
  const eventEntry: EvidenceRegistryEntry = {
    ref: "EV-1",
    origin: "Watchtower",
    timestamp: eventRow.createdAt?.toISOString() || new Date().toISOString(),
    engine: "Watchtower",
    table: "pipeline_change_events",
    recordId: eventRow.id,
    factType: "observed",
    age: eventFresh.age,
    freshnessStatus: eventFresh.status,
    confidence: "high",
    relevanceScore: 100,
    inclusionReason: "Primary event triggering the interpretation",
    detail: eventDetail,
    label: `Confirmed Change: ${eventRow.kind} (${eventRow.severity})`
  };
  logCandidate(eventEntry, 100, "included");

  const competitorId = eventRow.competitorId;

  // 2. Snapshots (Baseline and Current)
  if (eventRow.baselineSnapshotId) {
    const [baselineSnap] = await db
      .select()
      .from(pipelineSnapshots)
      .where(eq(pipelineSnapshots.id, eventRow.baselineSnapshotId))
      .limit(1);
    if (baselineSnap) {
      sourceVersions.baselineSnapshotId = baselineSnap.id;
      const fresh = getFreshnessState(baselineSnap.collectedAt || new Date());
      logCandidate({
        ref: "SNAP-BASE",
        origin: "Market Intelligence",
        timestamp: baselineSnap.collectedAt?.toISOString() || new Date().toISOString(),
        engine: "Market Intelligence",
        table: "pipeline_snapshots",
        recordId: baselineSnap.id,
        factType: "observed",
        age: fresh.age,
        freshnessStatus: fresh.status,
        confidence: "high",
        relevanceScore: 90,
        inclusionReason: "Baseline snapshot before the change occurred",
        detail: `Baseline Snapshot (ID: ${baselineSnap.id}) payload summary: ${(baselineSnap.payload || "").slice(0, 1000)}`,
        label: `Baseline Snapshot`
      }, 90, "included");
    }
  }

  if (eventRow.currentSnapshotId) {
    const [currentSnap] = await db
      .select()
      .from(pipelineSnapshots)
      .where(eq(pipelineSnapshots.id, eventRow.currentSnapshotId))
      .limit(1);
    if (currentSnap) {
      sourceVersions.currentSnapshotId = currentSnap.id;
      const fresh = getFreshnessState(currentSnap.collectedAt || new Date());
      logCandidate({
        ref: "SNAP-CURR",
        origin: "Market Intelligence",
        timestamp: currentSnap.collectedAt?.toISOString() || new Date().toISOString(),
        engine: "Market Intelligence",
        table: "pipeline_snapshots",
        recordId: currentSnap.id,
        factType: "observed",
        age: fresh.age,
        freshnessStatus: fresh.status,
        confidence: "high",
        relevanceScore: 95,
        inclusionReason: "Current snapshot confirming the change state",
        detail: `Current Snapshot (ID: ${currentSnap.id}) payload summary: ${(currentSnap.payload || "").slice(0, 1000)}`,
        label: `Current Snapshot`
      }, 95, "included");
    }
  }

  // 3. Strategy Plan
  const [activePlan] = await db
    .select()
    .from(strategicPlans)
    .where(
      and(
        eq(strategicPlans.accountId, accountId),
        eq(strategicPlans.campaignId, campaignId),
        eq(strategicPlans.status, "ACTIVE")
      )
    )
    .orderBy(desc(strategicPlans.createdAt))
    .limit(1);

  if (activePlan) {
    sourceVersions.strategicPlanId = activePlan.id;
    const fresh = getFreshnessState(activePlan.createdAt || new Date());
    logCandidate({
      ref: "BIZ-PLAN",
      origin: "Strategy Plan",
      timestamp: activePlan.createdAt?.toISOString() || new Date().toISOString(),
      engine: "Strategy Plan",
      table: "strategic_plans",
      recordId: activePlan.id,
      factType: "calculated",
      age: fresh.age,
      freshnessStatus: fresh.status,
      confidence: "high",
      relevanceScore: 85,
      inclusionReason: "Active company business strategy rules",
      detail: `Active Strategic Plan: summary="${activePlan.planSummary || "none"}", approvedRhythm="${activePlan.approvedRhythmJson || "none"}"`,
      label: `Active Strategy Plan`
    }, 85, "included");
  }

  // 4. Strategy Roots
  const [activeRoot] = await db
    .select()
    .from(strategyRoots)
    .where(
      and(
        eq(strategyRoots.accountId, accountId),
        eq(strategyRoots.campaignId, campaignId),
        eq(strategyRoots.status, "ACTIVE")
      )
    )
    .limit(1);

  if (activeRoot) {
    sourceVersions.strategyRootId = activeRoot.id;
    const fresh = getFreshnessState(activeRoot.createdAt || new Date());
    logCandidate({
      ref: "BIZ-ROOT",
      origin: "Strategy Roots",
      timestamp: activeRoot.createdAt?.toISOString() || new Date().toISOString(),
      engine: "Strategy Roots",
      table: "strategy_roots",
      recordId: activeRoot.id,
      factType: "calculated",
      age: fresh.age,
      freshnessStatus: fresh.status,
      confidence: "high",
      relevanceScore: 88,
      inclusionReason: "Grounded strategy anchor pains, desires, objections and core claim",
      detail: `Approved claim: "${activeRoot.approvedClaim || "none"}", approved mechanism: "${activeRoot.approvedMechanism || "none"}", approved objection: "${activeRoot.approvedObjections || "none"}", primary transformation axis: "${activeRoot.primaryAxis || "none"}"`,
      label: `Strategy doctrine root`
    }, 88, "included");
  }

  // 5. Build Up Plan
  const [activeBuildPlan] = await db
    .select()
    .from(buildPlanSnapshots)
    .where(
      and(
        eq(buildPlanSnapshots.accountId, accountId),
        eq(buildPlanSnapshots.campaignId, campaignId),
        eq(buildPlanSnapshots.status, "ACTIVE")
      )
    )
    .orderBy(desc(buildPlanSnapshots.createdAt))
    .limit(1);

  if (activeBuildPlan) {
    sourceVersions.buildPlanSnapshotId = activeBuildPlan.id;
    const fresh = getFreshnessState(activeBuildPlan.createdAt || new Date());
    logCandidate({
      ref: "BIZ-BUILD",
      origin: "Build Up Plan",
      timestamp: activeBuildPlan.createdAt?.toISOString() || new Date().toISOString(),
      engine: "Build Up Plan",
      table: "build_plan_snapshots",
      recordId: activeBuildPlan.id,
      factType: "calculated",
      age: fresh.age,
      freshnessStatus: fresh.status,
      confidence: "high",
      relevanceScore: 80,
      inclusionReason: "Current build-up execution layout plan",
      detail: `Active Build Plan: plan="${(activeBuildPlan.plan || "").slice(0, 500)}", actionabilityScore=${activeBuildPlan.actionabilityScore}`,
      label: `Active Build Plan`
    }, 80, "included");
  }

  // 6. Market Intelligence (miSnapshots)
  const [latestMi] = await db
    .select()
    .from(miSnapshots)
    .where(
      and(
        eq(miSnapshots.accountId, accountId),
        eq(miSnapshots.campaignId, campaignId)
      )
    )
    .orderBy(desc(miSnapshots.createdAt))
    .limit(1);

  if (latestMi) {
    sourceVersions.miSnapshotId = latestMi.id;
    const fresh = getFreshnessState(latestMi.createdAt || new Date());
    logCandidate({
      ref: "MI-SNAP",
      origin: "Market Intelligence",
      timestamp: latestMi.createdAt?.toISOString() || new Date().toISOString(),
      engine: "Market Intelligence",
      table: "mi_snapshots",
      recordId: latestMi.id,
      factType: "calculated",
      age: fresh.age,
      freshnessStatus: fresh.status,
      confidence: "high",
      relevanceScore: 78,
      inclusionReason: "Market intelligence snapshot of competitor metrics",
      detail: `Competitors tracked: ${latestMi.includedCompetitorIds || "none"}. Raw metrics summary: ${(latestMi.competitorData || "").slice(0, 500)}`,
      label: `Latest MI Snapshot`
    }, 78, "included");
  }

  // 7. Audience Snapshots
  const [latestAudience] = await db
    .select()
    .from(audienceSnapshots)
    .where(
      and(
        eq(audienceSnapshots.accountId, accountId),
        eq(audienceSnapshots.campaignId, campaignId)
      )
    )
    .orderBy(desc(audienceSnapshots.createdAt))
    .limit(1);

  if (latestAudience) {
    sourceVersions.audienceSnapshotId = latestAudience.id;
    const fresh = getFreshnessState(latestAudience.createdAt || new Date());
    logCandidate({
      ref: "AUD-SNAP",
      origin: "Audience Engine",
      timestamp: latestAudience.createdAt?.toISOString() || new Date().toISOString(),
      engine: "Audience Engine",
      table: "audience_snapshots",
      recordId: latestAudience.id,
      factType: "calculated",
      age: fresh.age,
      freshnessStatus: fresh.status,
      confidence: "high",
      relevanceScore: 75,
      inclusionReason: "Audience analysis segment details",
      detail: `Active target segments: ${(latestAudience.audienceSegments || "").slice(0, 500)}`,
      label: `Latest Audience Snapshot`
    }, 75, "included");
  }

  // 8. Positioning Snapshots
  const [latestPositioning] = await db
    .select()
    .from(positioningSnapshots)
    .where(
      and(
        eq(positioningSnapshots.accountId, accountId),
        eq(positioningSnapshots.campaignId, campaignId)
      )
    )
    .orderBy(desc(positioningSnapshots.createdAt))
    .limit(1);

  if (latestPositioning) {
    sourceVersions.positioningSnapshotId = latestPositioning.id;
    const fresh = getFreshnessState(latestPositioning.createdAt || new Date());
    logCandidate({
      ref: "POS-SNAP",
      origin: "Positioning Strategy",
      timestamp: latestPositioning.createdAt?.toISOString() || new Date().toISOString(),
      engine: "Positioning Strategy",
      table: "positioning_snapshots",
      recordId: latestPositioning.id,
      factType: "calculated",
      age: fresh.age,
      freshnessStatus: fresh.status,
      confidence: "high",
      relevanceScore: 75,
      inclusionReason: "Market positioning narrative and territory snapshot",
      detail: `Narrative strategy: narrativeDirection="${latestPositioning.narrativeDirection || "none"}", enemyDefinition="${latestPositioning.enemyDefinition || "none"}"`,
      label: `Latest Positioning Snapshot`
    }, 75, "included");
  }

  // 9. Competitor DNA
  if (competitorId) {
    const [compProfile] = await db
      .select()
      .from(ciCompetitors)
      .where(
        and(
          eq(ciCompetitors.accountId, accountId),
          eq(ciCompetitors.campaignId, campaignId),
          eq(ciCompetitors.id, competitorId)
        )
      )
      .limit(1);

    if (compProfile) {
      sourceVersions.competitorProfileId = compProfile.id;
      const fresh = getFreshnessState(compProfile.websiteScrapedAt || new Date());
      logCandidate({
        ref: "COMP-DNA",
        origin: "Competitor DNA",
        timestamp: compProfile.websiteScrapedAt?.toISOString() || new Date().toISOString(),
        engine: "Competitor DNA",
        table: "ci_competitors",
        recordId: compProfile.id,
        factType: "observed",
        age: fresh.age,
        freshnessStatus: fresh.status,
        confidence: "high",
        relevanceScore: 82,
        inclusionReason: "Detailed DNA posture of this specific competitor",
        detail: `Competitor DNA profile: name="${compProfile.name}", businessType="${compProfile.businessType}", primaryObjective="${compProfile.primaryObjective}", postingFrequency="${compProfile.postingFrequency || 0} posts/wk", ctaPatterns="${compProfile.ctaPatterns || "none"}", messagingTone="${compProfile.messagingTone || "none"}"`,
        label: `Competitor Profile: ${compProfile.name}`
      }, 82, "included");
    }
  }

  // 10. Content DNA
  const [latestContentDna] = await db
    .select()
    .from(contentDna)
    .where(
      and(
        eq(contentDna.accountId, accountId),
        eq(contentDna.campaignId, campaignId)
      )
    )
    .orderBy(desc(contentDna.createdAt))
    .limit(1);

  if (latestContentDna) {
    sourceVersions.contentDnaId = latestContentDna.id;
    const fresh = getFreshnessState(latestContentDna.createdAt || new Date());
    logCandidate({
      ref: "BIZ-DNA",
      origin: "Strategy Plan",
      timestamp: latestContentDna.createdAt?.toISOString() || new Date().toISOString(),
      engine: "Strategy Plan",
      table: "content_dna",
      recordId: latestContentDna.id,
      factType: "calculated",
      age: fresh.age,
      freshnessStatus: fresh.status,
      confidence: "high",
      relevanceScore: 78,
      inclusionReason: "Our own content DNA styling guidelines",
      detail: `Content DNA: messagingCore="${(latestContentDna.messagingCore || "").slice(0, 150)}", ctaDna="${(latestContentDna.ctaDna || "").slice(0, 100)}", hookDna="${(latestContentDna.hookDna || "").slice(0, 100)}", narrativeDna="${(latestContentDna.narrativeDna || "").slice(0, 100)}"`,
      label: `Our Content DNA`
    }, 78, "included");
  }

  // 11. Competitor Post Classifications
  if (competitorId) {
    const classList = await db
      .select({
        id: competitorPostClassifications.id,
        postId: competitorPostClassifications.postId,
        competitorId: competitorPostClassifications.competitorId,
        primaryHook: competitorPostClassifications.primaryHook,
        primaryAngle: competitorPostClassifications.primaryAngle,
        hookArchetype: competitorPostClassifications.hookArchetype,
        narrative: competitorPostClassifications.narrative,
        ctaType: competitorPostClassifications.ctaType,
        offerType: competitorPostClassifications.offerType,
        emotionalTrigger: competitorPostClassifications.emotionalTrigger,
        awarenessStage: competitorPostClassifications.awarenessStage,
        positioningStyle: competitorPostClassifications.positioningStyle,
        contentFormatIntent: competitorPostClassifications.contentFormatIntent,
        primaryGoal: competitorPostClassifications.primaryGoal,
        confidenceScore: competitorPostClassifications.confidenceScore,
        postCaption: ciCompetitorPosts.caption,
        postTimestamp: ciCompetitorPosts.timestamp
      })
      .from(competitorPostClassifications)
      .innerJoin(ciCompetitorPosts, eq(competitorPostClassifications.postId, ciCompetitorPosts.postId))
      .where(
        and(
          eq(ciCompetitorPosts.accountId, accountId),
          eq(ciCompetitorPosts.competitorId, competitorId)
        )
      )
      .orderBy(desc(ciCompetitorPosts.timestamp))
      .limit(10);

    classList.forEach((c, idx) => {
      const fresh = getFreshnessState(c.postTimestamp || new Date());
      const isIncluded = idx < 3;
      const ref = `COMP-POST-${idx + 1}`;
      const detail = `Post classification: postText="${(c.postCaption || "").slice(0, 150)}", primaryHook="${c.primaryHook || "none"}", primaryAngle="${c.primaryAngle || "none"}", hookArchetype="${c.hookArchetype}", narrative="${c.narrative}", ctaType="${c.ctaType}", offerType="${c.offerType}", emotionalTrigger="${c.emotionalTrigger}", awarenessStage="${c.awarenessStage}", positioningStyle="${c.positioningStyle}", contentFormatIntent="${c.contentFormatIntent}", primaryGoal="${c.primaryGoal}".`;
      logCandidate({
        ref,
        origin: "Competitor DNA",
        timestamp: c.postTimestamp?.toISOString() || new Date().toISOString(),
        engine: "Competitor DNA",
        table: "competitor_post_classifications",
        recordId: c.id,
        factType: "observed",
        age: fresh.age,
        freshnessStatus: fresh.status,
        confidence: "high",
        relevanceScore: 70 - idx * 2,
        inclusionReason: "Recent public post messaging classification detail",
        detail,
        label: `Competitor post classification ${c.id}`
      }, 70 - idx * 2, isIncluded ? "included" : "excluded", isIncluded ? null : "Token budget: limited to top 3 recent posts");
    });
  }

  // 12 & 13. Historical Confirmed events & Reversion History
  if (competitorId) {
    const historicalEvents = await db
      .select()
      .from(pipelineChangeEvents)
      .where(
        and(
          eq(pipelineChangeEvents.accountId, accountId),
          eq(pipelineChangeEvents.campaignId, campaignId),
          eq(pipelineChangeEvents.competitorId, competitorId),
          eq(pipelineChangeEvents.status, "confirmed"),
          ne(pipelineChangeEvents.id, eventId)
        )
      )
      .orderBy(desc(pipelineChangeEvents.createdAt))
      .limit(5);

    historicalEvents.forEach((h, idx) => {
      const fresh = getFreshnessState(h.createdAt || new Date());
      const ref = `HIST-EV-${idx + 1}`;
      const detail = `Past Confirmed Event: kind="${h.kind}", severity="${h.severity}", scope="${h.scope}", destination="${h.toValue || "unknown"}". Evidence summary: ${h.evidence || "none"}`;
      logCandidate({
        ref,
        origin: "Watchtower",
        timestamp: h.createdAt?.toISOString() || new Date().toISOString(),
        engine: "Watchtower",
        table: "pipeline_change_events",
        recordId: h.id,
        factType: "observed",
        age: fresh.age,
        freshnessStatus: fresh.status,
        confidence: "high",
        relevanceScore: 65 - idx * 2,
        inclusionReason: "Historical confirmed event for context trend comparison",
        detail,
        label: `Past Confirmed Event`
      }, 65 - idx * 2, "included");
    });
  }

  // 14. Performance Cycle Reports
  const reports = await db
    .select()
    .from(performanceCycleReports)
    .where(
      and(
        eq(performanceCycleReports.accountId, accountId),
        eq(performanceCycleReports.campaignId, campaignId)
      )
    )
    .orderBy(desc(performanceCycleReports.createdAt))
    .limit(3);

  reports.forEach((r, idx) => {
    const fresh = getFreshnessState(r.createdAt || new Date());
    const ref = `PERF-REP-${idx + 1}`;
    logCandidate({
      ref,
      origin: "Performance Loop",
      timestamp: r.createdAt?.toISOString() || new Date().toISOString(),
      engine: "Performance Loop",
      table: "performance_cycle_reports",
      recordId: r.id,
      factType: "calculated",
      age: fresh.age,
      freshnessStatus: fresh.status,
      confidence: "high",
      relevanceScore: 68 - idx * 2,
      inclusionReason: "Recent business conversion and spend details",
      detail: `Performance report: platform=${r.platform}, sales=${r.salesBefore} -> ${r.salesAfter}, decisionsCount=${r.decisionsTotal}, verdict=${r.businessVerdict}`,
      label: `Performance Report: ${r.platform}`
    }, 68 - idx * 2, "included");
  });

  // 15. Performance Decision Verdicts
  const verdicts = await db
    .select()
    .from(performanceDecisionVerdicts)
    .where(
      and(
        eq(performanceDecisionVerdicts.accountId, accountId),
        eq(performanceDecisionVerdicts.campaignId, campaignId)
      )
    )
    .orderBy(desc(performanceDecisionVerdicts.createdAt))
    .limit(5);

  verdicts.forEach((v, idx) => {
    const fresh = getFreshnessState(v.createdAt || new Date());
    const ref = `PERF-VERD-${idx + 1}`;
    logCandidate({
      ref,
      origin: "Performance Loop",
      timestamp: v.createdAt?.toISOString() || new Date().toISOString(),
      engine: "Performance Loop",
      table: "performance_decision_verdicts",
      recordId: v.id,
      factType: "calculated",
      age: fresh.age,
      freshnessStatus: fresh.status,
      confidence: "high",
      relevanceScore: 66 - idx * 2,
      inclusionReason: "Performance verdict linked to prior strategy decisions",
      detail: `Verdict details: dimension=${v.decisionDimension}, value=${v.decisionValue}, verdict=${v.verdict}, reason=${v.verdictReason}`,
      label: `Decision Verdict`
    }, 66 - idx * 2, "included");
  });

  // 16. Weekly User Metrics
  const scores = await db
    .select()
    .from(weeklyBusinessScores)
    .where(
      and(
        eq(weeklyBusinessScores.accountId, accountId),
        eq(weeklyBusinessScores.campaignId, campaignId)
      )
    )
    .orderBy(desc(weeklyBusinessScores.createdAt))
    .limit(4);

  scores.forEach((s, idx) => {
    const fresh = getFreshnessState(s.createdAt || new Date());
    const ref = `BIZ-METRIC-${idx + 1}`;
    logCandidate({
      ref,
      origin: "Performance Loop",
      timestamp: s.createdAt?.toISOString() || new Date().toISOString(),
      engine: "Performance Loop",
      table: "weekly_business_scores",
      recordId: s.id,
      factType: "calculated",
      age: fresh.age,
      freshnessStatus: fresh.status,
      confidence: "high",
      relevanceScore: 60 - idx * 2,
      inclusionReason: "Internal weekly business conversion metrics",
      detail: `Weekly business score: conversionRate=${((s.leadToPayingRate || 0) * 100).toFixed(2)}%, totalSales=${s.payingCustomers || 0}, activeLeadsCount=${s.leads || 0}`,
      label: `Weekly Business Metrics`
    }, 60 - idx * 2, "included");
  });

  // 17. User Channel Snapshots
  const channelSnaps = await db
    .select()
    .from(userChannelSnapshots)
    .where(
      and(
        eq(userChannelSnapshots.accountId, accountId),
        eq(userChannelSnapshots.campaignId, campaignId)
      )
    )
    .orderBy(desc(userChannelSnapshots.scrapedAt))
    .limit(3);

  channelSnaps.forEach((c, idx) => {
    const fresh = getFreshnessState(c.scrapedAt || new Date());
    const ref = `USER-CHAN-${idx + 1}`;
    logCandidate({
      ref,
      origin: "Performance Loop",
      timestamp: c.scrapedAt?.toISOString() || new Date().toISOString(),
      engine: "Performance Loop",
      table: "user_channel_snapshots",
      recordId: c.id,
      factType: "observed",
      age: fresh.age,
      freshnessStatus: fresh.status,
      confidence: "high",
      relevanceScore: 58 - idx * 2,
      inclusionReason: "Active user account social reach metrics",
      detail: `User Channel snapshot: platform=${c.platform}, handle=${c.handle || "unknown"}, snapshotData=${(c.snapshotData || "").slice(0, 300)}`,
      label: `User Channel Snapshot`
    }, 58 - idx * 2, "included");
  });

  // 18. Business Profile
  const [bizProfile] = await db
    .select()
    .from(businessDataLayer)
    .where(
      and(
        eq(businessDataLayer.accountId, accountId),
        eq(businessDataLayer.campaignId, campaignId)
      )
    )
    .limit(1);

  if (bizProfile) {
    sourceVersions.businessProfileId = bizProfile.id;
    const fresh = getFreshnessState(bizProfile.updatedAt || new Date());
    logCandidate({
      ref: "BIZ-PROF",
      origin: "Strategy Plan",
      timestamp: bizProfile.updatedAt?.toISOString() || new Date().toISOString(),
      engine: "Strategy Plan",
      table: "business_data_layer",
      recordId: bizProfile.id,
      factType: "observed",
      age: fresh.age,
      freshnessStatus: fresh.status,
      confidence: "high",
      relevanceScore: 92,
      inclusionReason: "Static business configurations and product features",
      detail: `Business type: "${bizProfile.businessType}", ProductCategory: "${bizProfile.productCategory}", Core offer: "${bizProfile.coreOffer || "none"}", target audience: "${bizProfile.targetAudienceSegment || "none"}", unique mechanism: "${bizProfile.uniqueMechanism || "none"}"`,
      label: `Company Business Profile`
    }, 92, "included");
  }

  // 19. Active Goals/Objectives
  const [goalDec] = await db
    .select()
    .from(goalDecompositions)
    .where(
      and(
        eq(goalDecompositions.accountId, accountId),
        eq(goalDecompositions.campaignId, campaignId),
        eq(goalDecompositions.status, "active")
      )
    )
    .orderBy(desc(goalDecompositions.createdAt))
    .limit(1);

  if (goalDec) {
    sourceVersions.goalDecompositionId = goalDec.id;
    const fresh = getFreshnessState(goalDec.createdAt || new Date());
    logCandidate({
      ref: "BIZ-GOAL",
      origin: "Strategy Plan",
      timestamp: goalDec.createdAt?.toISOString() || new Date().toISOString(),
      engine: "Strategy Plan",
      table: "goal_decompositions",
      recordId: goalDec.id,
      factType: "observed",
      age: fresh.age,
      freshnessStatus: fresh.status,
      confidence: "high",
      relevanceScore: 87,
      inclusionReason: "Active strategic business goals",
      detail: `Active Goal: type="${goalDec.goalType}", target="${goalDec.goalTarget}", timeframe="${goalDec.timeHorizonDays} days", feasibility="${goalDec.feasibility}"`,
      label: `Active Business Goal`
    }, 87, "included");
  }

  // 20. Public Competitor Metrics
  if (competitorId) {
    const [latestMetrics] = await db
      .select()
      .from(ciCompetitorMetricsSnapshot)
      .where(eq(ciCompetitorMetricsSnapshot.competitorId, competitorId))
      .orderBy(desc(ciCompetitorMetricsSnapshot.lastFetchAt))
      .limit(1);

    if (latestMetrics) {
      sourceVersions.ciCompetitorMetricsSnapshotId = latestMetrics.id;
      const fresh = getFreshnessState(latestMetrics.lastFetchAt || new Date());
      logCandidate({
        ref: "COMP-METRIC",
        origin: "Competitor DNA",
        timestamp: latestMetrics.lastFetchAt?.toISOString() || new Date().toISOString(),
        engine: "Competitor DNA",
        table: "ci_competitor_metrics_snapshot",
        recordId: latestMetrics.id,
        factType: "observed",
        age: fresh.age,
        freshnessStatus: fresh.status,
        confidence: "high",
        relevanceScore: 76,
        inclusionReason: "Scraped competitor public statistics (followers, engagements)",
        detail: `Public metrics: followers=${latestMetrics.followers || 0}, engagementRate=${latestMetrics.engagementRate || 0}%, postingFrequency=${latestMetrics.postingFrequency || 0} posts/day, fetchMethod=${latestMetrics.fetchMethod || "unknown"}`,
        label: `Competitor Public Metrics`
      }, 76, "included");
    }
  }

  // 21. Deduplicate semantically identical facts
  const deduplicatedRegistry: EvidenceRegistryEntry[] = [];
  const uniqueDetails = new Set<string>();

  // Sort candidates by relevance score descending so we keep the highest scoring ones
  const sortedCandidates = rawCandidates.sort((a, b) => b.relevanceScore - a.relevanceScore);

  for (const c of sortedCandidates) {
    // Determine if it was already marked excluded in the candidate logging stage
    const lineageItem = contextLineage.find((l) => l.recordId === c.recordId && l.table === c.table);
    if (lineageItem && lineageItem.verdict === "excluded") {
      continue;
    }

    const normDetail = c.detail.toLowerCase().replace(/\s+/g, " ").trim();
    if (uniqueDetails.has(normDetail)) {
      if (lineageItem) {
        lineageItem.verdict = "excluded";
        lineageItem.exclusionReason = "Deduplication: Identical semantic details already included";
      }
      continue;
    }
    uniqueDetails.add(normDetail);
    deduplicatedRegistry.push(c);
  }

  // 22. Select strongest evidence within a strict token budget (e.g. 6000 tokens)
  const TOKEN_BUDGET = 6000;
  let runningTokenCount = 0;
  const finalRegistry: EvidenceRegistryEntry[] = [];

  for (const c of deduplicatedRegistry) {
    const tokens = estimateTokens(c.detail);
    const lineageItem = contextLineage.find((l) => l.recordId === c.recordId && l.table === c.table);

    if (runningTokenCount + tokens <= TOKEN_BUDGET) {
      runningTokenCount += tokens;
      finalRegistry.push(c);
    } else {
      if (lineageItem) {
        lineageItem.verdict = "excluded";
        lineageItem.exclusionReason = `Token budget exceeded (limit=${TOKEN_BUDGET}, current=${runningTokenCount})`;
      }
    }
  }

  // Compute final context fingerprint (MD5/SHA256 equivalent hash of finalized registry IDs and versions)
  const crypto = require("crypto");
  const fingerprintSource = JSON.stringify({
    ids: finalRegistry.map((r) => r.recordId).sort(),
    versions: sourceVersions
  });
  const contextFingerprint = crypto
    .createHash("sha256")
    .update(fingerprintSource)
    .digest("hex");

  return {
    evidenceRegistry: finalRegistry,
    contextLineage,
    sourceVersions,
    contextFingerprint
  };
}
