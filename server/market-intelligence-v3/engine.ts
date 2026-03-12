import { db } from "../db";
import { miSnapshots, miSignalLogs, miTelemetry, ciCompetitors, growthCampaigns } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { pruneOldSnapshots } from "../engine-hardening";
import { computeAllSignals, aggregateMissingFlags, classifyEngagementQuality, detectAudienceIntentSignals, detectSampleBias, computeRealDataRatio, clusterSemanticSignals } from "./signal-engine";
import { extractNarrativeObjections } from "./narrative-objection-extractor";
import type { SignalCluster, SignalPipelineDiagnostics } from "./types";
import { computeDemandPressure } from "./demand-pressure";
import { detectEchoChamber } from "./narrative-clustering";
import { classifyAllIntents, computeDominantMarketIntent } from "./intent-engine";
import { computeTrajectory, deriveTrajectoryDirection, deriveMarketState, deriveCompetitionIntensityLevel } from "./trajectory-engine";
import { computeConfidence } from "./confidence-engine";
import { computeAllDominance } from "./dominance-module";
import { computeTokenBudget, applySampling } from "./token-budget";
import { computeSimilarityDiagnosis } from "./similarity-engine";
import { computeAllContentDNA } from "./content-dna";
import { computeMarketBaseline, computeAllDeviations, computeDynamicThreshold, type DeviationResult, type CalibrationContext } from "./market-baselines";
import type {
  MIv3Mode,
  MIv3Output,
  MIv3DiagnosticResult,
  MIDiagnostics,
  CompetitorInput,
  TelemetryRecord,
  TwoRunConfirmation,
  ExecutionMode,
  GoalMode,
  SimilarityResult,
  DeltaReport,
  SignalDelta,
  IntentChange,
  TrajectoryDelta,
  DominanceChange,
  EvidenceCoverage,
  EngagementQuality,
} from "./types";
import { MI_CONFIDENCE, ENGINE_VERSION, INSTAGRAM_API_CEILING } from "./constants";
import { validateEngineIsolation, validateNoStrategyWrite } from "./isolation-guard";
import { logAudit } from "../audit";
import { computeCompetitorHash, parseJsonSafe } from "./utils";
import { getStoredPostsForMIv3, getStoredCommentsForMIv3 } from "../competitive-intelligence/data-acquisition";
import { logSignalDiagnostics, detectNarrativeOverlap } from "../engine-hardening";
import { createSourceLineageEntry, type SignalLineageEntry } from "../shared/signal-lineage";

export { computeCompetitorHash } from "./utils";
export { ENGINE_VERSION } from "./constants";

const SNAPSHOT_FRESHNESS_HOURS = 24;
const ISOLATION_ALLOWED_CALLER = "MARKET_INTELLIGENCE_V3";

const activeLocks = new Map<string, Promise<MIv3DiagnosticResult>>();

interface SnapshotValidationResult {
  valid: boolean;
  failures: string[];
}

export function validateSnapshotCompleteness(snapshot: {
  signalData?: string | null;
  intentData?: string | null;
  trajectoryData?: string | null;
  dominanceData?: string | null;
  confidenceData?: string | null;
  marketState?: string | null;
  volatilityIndex?: number | null;
  marketDiagnosis?: string | null;
  threatSignals?: string | null;
  opportunitySignals?: string | null;
  narrativeSynthesis?: string | null;
  confidenceLevel?: string | null;
}): SnapshotValidationResult {
  const failures: string[] = [];

  if (!snapshot.marketState || snapshot.marketState === "PENDING") {
    failures.push("marketState is missing or PENDING");
  }

  const trajectoryData = parseJsonSafe(snapshot.trajectoryData, null);
  if (!trajectoryData || typeof trajectoryData !== "object") {
    failures.push("trajectoryData is missing or invalid");
  }

  const dominanceData = parseJsonSafe(snapshot.dominanceData, null);
  if (!dominanceData || (Array.isArray(dominanceData) && dominanceData.length === 0)) {
    failures.push("dominanceData is missing or empty");
  }

  const confidenceData = parseJsonSafe(snapshot.confidenceData, null);
  if (!confidenceData || typeof confidenceData !== "object") {
    failures.push("confidenceData is missing or invalid");
  }

  if (snapshot.volatilityIndex === null || snapshot.volatilityIndex === undefined) {
    failures.push("volatilityIndex is null");
  }

  const threatSignals = parseJsonSafe(snapshot.threatSignals, null);
  if (threatSignals === null) {
    failures.push("threatSignals is null (must be array, even if empty)");
  }

  const opportunitySignals = parseJsonSafe(snapshot.opportunitySignals, null);
  if (opportunitySignals === null) {
    failures.push("opportunitySignals is null (must be array, even if empty)");
  }

  const signalData = parseJsonSafe(snapshot.signalData, null);
  if (!signalData || (Array.isArray(signalData) && signalData.length === 0)) {
    failures.push("signalData is missing or empty");
  }

  const intentData = parseJsonSafe(snapshot.intentData, null);
  if (!intentData || (Array.isArray(intentData) && intentData.length === 0)) {
    failures.push("intentData is missing or empty");
  }

  const guardDecision = confidenceData?.guardDecision;
  const isProceed = guardDecision === "PROCEED";

  if (isProceed) {
    if (!snapshot.marketDiagnosis) {
      failures.push("marketDiagnosis is null (required when guardDecision=PROCEED)");
    }
    if (!snapshot.narrativeSynthesis) {
      failures.push("narrativeSynthesis is null (required when guardDecision=PROCEED)");
    }
  }

  return { valid: failures.length === 0, failures };
}

function isSnapshotAnalyticallyComplete(snapshot: any): boolean {
  const validation = validateSnapshotCompleteness(snapshot);
  if (!validation.valid) {
    console.log(`[MIv3] CACHE_INVALID_INCOMPLETE_SNAPSHOT | failures=${validation.failures.join(", ")} | snapshotId=${snapshot.id}`);
    return false;
  }
  return true;
}

export async function persistValidatedSnapshot(snapshotPayload: any, caller: string): Promise<any> {
  const strategyDomainFields = ["positioningOutput", "differentiationOutput", "audienceOutput", "offerOutput", "pricingOutput", "funnelOutput", "strategyOutput"];
  for (const field of strategyDomainFields) {
    if (snapshotPayload[field]) {
      validateNoStrategyWrite("MARKET_INTELLIGENCE_V3", field.replace("Output", "").toUpperCase());
    }
  }

  if (!snapshotPayload.analysisVersion) {
    snapshotPayload.analysisVersion = ENGINE_VERSION;
  }

  if (snapshotPayload.status === "COMPLETE") {
    const completionCheck = validateSnapshotCompleteness(snapshotPayload);
    if (!completionCheck.valid) {
      console.log(`[MIv3] SNAPSHOT_COMPLETION_CONTRACT_VIOLATED | caller=${caller} | failures=${completionCheck.failures.join(", ")}`);
      snapshotPayload.status = "PARTIAL";
    }
  }

  if (snapshotPayload.accountId && snapshotPayload.campaignId) {
    const existingBaseline = await db.select({ id: miSnapshots.id, dataStatus: miSnapshots.dataStatus, version: miSnapshots.version, snapshotSource: miSnapshots.snapshotSource })
      .from(miSnapshots)
      .where(and(
        eq(miSnapshots.accountId, snapshotPayload.accountId),
        eq(miSnapshots.campaignId, snapshotPayload.campaignId),
        eq(miSnapshots.status, "COMPLETE"),
      ))
      .orderBy(desc(miSnapshots.createdAt))
      .limit(1);

    if (existingBaseline.length > 0) {
      const baseline = existingBaseline[0];
      const baselineIsLive = baseline.dataStatus === "LIVE";
      const newIsAlsoLive = snapshotPayload.dataStatus === "LIVE";
      const newSourceIsFresh = snapshotPayload.snapshotSource === "FRESH_DATA";

      if (baselineIsLive && newIsAlsoLive && newSourceIsFresh && snapshotPayload.version === baseline.version) {
        console.log(`[MIv3] SNAPSHOT_IMMUTABILITY_VIOLATION | caller=${caller} | existingSnapshotId=${baseline.id} | existingVersion=${baseline.version} | reason=FAST_PASS baseline cannot be overwritten, only new DEEP_PASS snapshots can be added alongside`);
        snapshotPayload.version = (baseline.version || 0) + 1;
      }
    }
  }

  const [snapshot] = await db.insert(miSnapshots).values(snapshotPayload).returning();
  await pruneOldSnapshots(db, miSnapshots, snapshotPayload.campaignId, 20, snapshotPayload.accountId || "default");
  return snapshot;
}

async function getCompetitorData(accountId: string, campaignId: string): Promise<CompetitorInput[]> {
  const competitors = await db.select().from(ciCompetitors)
    .where(and(eq(ciCompetitors.accountId, accountId), eq(ciCompetitors.campaignId, campaignId), eq(ciCompetitors.isActive, true)));

  const pendingCount = competitors.filter(c => c.enrichmentStatus === "PENDING" || !c.enrichmentStatus).length;
  const enrichedCount = competitors.filter(c => c.enrichmentStatus === "ENRICHED").length;
  const fastPassOnly = competitors.filter(c => (c.analysisLevel || "FAST_PASS") === "FAST_PASS" && c.enrichmentStatus !== "ENRICHED").length;
  if (competitors.length > 0) {
    console.log(`[MIv3] INVENTORY_STATUS | total=${competitors.length} | enriched=${enrichedCount} | pending=${pendingCount} | fastPassOnly=${fastPassOnly}`);
  }

  const results: CompetitorInput[] = [];
  for (const c of competitors) {
    const posts = await getStoredPostsForMIv3(c.id, accountId);
    const comments = await getStoredCommentsForMIv3(c.id, accountId);

    results.push({
      id: c.id,
      name: c.name,
      platform: c.platform,
      profileLink: c.profileLink,
      businessType: c.businessType,
      postingFrequency: c.postingFrequency,
      contentTypeRatio: c.contentTypeRatio,
      engagementRatio: c.engagementRatio,
      ctaPatterns: c.ctaPatterns,
      discountFrequency: c.discountFrequency,
      hookStyles: c.hookStyles,
      messagingTone: c.messagingTone,
      socialProofPresence: c.socialProofPresence,
      posts,
      comments,
    });
  }
  return results;
}

interface CacheResult {
  snapshot: any | null;
  invalidationReason: import("./types").CacheInvalidationReason;
}

async function getCachedSnapshot(accountId: string, campaignId: string, competitorHash: string): Promise<CacheResult> {
  const snapshots = await db.select().from(miSnapshots)
    .where(and(
      eq(miSnapshots.accountId, accountId),
      eq(miSnapshots.campaignId, campaignId),
      eq(miSnapshots.status, "COMPLETE"),
    ))
    .orderBy(desc(miSnapshots.createdAt))
    .limit(1);

  if (snapshots.length === 0) return { snapshot: null, invalidationReason: null };

  const snapshot = snapshots[0];

  if (snapshot.competitorHash && snapshot.competitorHash !== competitorHash) {
    console.log(`[MIv3] Snapshot invalidated: competitor set changed (${snapshot.competitorHash} → ${competitorHash})`);
    return { snapshot: null, invalidationReason: "COMPETITOR_SET_CHANGED" };
  }

  const snapshotVersion = snapshot.analysisVersion || 0;
  if (snapshotVersion !== ENGINE_VERSION) {
    console.log(`[MIv3] SNAPSHOT_VERSION_INVALIDATED | snapshotId=${snapshot.id} | snapshotVersion=${snapshotVersion} | engineVersion=${ENGINE_VERSION} | reason=engine_upgrade`);
    return { snapshot: null, invalidationReason: "ENGINE_UPGRADE" };
  }

  if (!isSnapshotAnalyticallyComplete(snapshot)) {
    return { snapshot: null, invalidationReason: "INCOMPLETE_SNAPSHOT" };
  }

  const age = Date.now() - new Date(snapshot.createdAt!).getTime();
  const freshnessMs = SNAPSHOT_FRESHNESS_HOURS * 60 * 60 * 1000;

  if (age > freshnessMs) return { snapshot: null, invalidationReason: "STALE" };

  return { snapshot, invalidationReason: null };
}

export function computeDataFreshnessDays(competitors: CompetitorInput[]): number {
  if (competitors.length === 0) return 999;
  const now = Date.now();
  let newest = 0;
  for (const c of competitors) {
    for (const p of c.posts || []) {
      const t = new Date(p.timestamp).getTime();
      if (!isNaN(t) && t > newest) newest = t;
    }
    for (const cm of c.comments || []) {
      const t = new Date(cm.timestamp).getTime();
      if (!isNaN(t) && t > newest) newest = t;
    }
  }
  if (newest === 0) return 999;
  const days = Math.max(0, Math.round((now - newest) / (1000 * 60 * 60 * 24)));
  if (days > 365) {
    let recentSignalExists = false;
    const recentThreshold = now - 365 * 24 * 60 * 60 * 1000;
    for (const c of competitors) {
      for (const p of c.posts || []) {
        const t = new Date(p.timestamp).getTime();
        if (!isNaN(t) && t > recentThreshold) { recentSignalExists = true; break; }
      }
      if (recentSignalExists) break;
      for (const cm of c.comments || []) {
        const t = new Date(cm.timestamp).getTime();
        if (!isNaN(t) && t > recentThreshold) { recentSignalExists = true; break; }
      }
      if (recentSignalExists) break;
    }
    if (recentSignalExists) {
      console.log(`[MIv3] FRESHNESS_ANOMALY_GUARD: computed ${days}d but recent signals exist — recomputing`);
      let corrected = 0;
      for (const c of competitors) {
        for (const p of c.posts || []) {
          const t = new Date(p.timestamp).getTime();
          if (!isNaN(t) && t > corrected && t <= now) corrected = t;
        }
        for (const cm of c.comments || []) {
          const t = new Date(cm.timestamp).getTime();
          if (!isNaN(t) && t > corrected && t <= now) corrected = t;
        }
      }
      if (corrected > 0) return Math.round((now - corrected) / (1000 * 60 * 60 * 24));
    }
  }
  return days;
}

export function computeVolatilityIndex(signalResults: any[]): number {
  if (signalResults.length === 0) return 0;
  const volatilities = signalResults.map((r: any) => {
    const s = r.signals;
    return (
      Math.abs(s.engagementVolatility || 0) * 0.3 +
      Math.abs(s.ctaIntensityShift || 0) * 0.25 +
      Math.abs(s.postingFrequencyTrend || 0) * 0.25 +
      Math.abs(s.contentExperimentRate || 0) * 0.2
    );
  });
  return Math.min(1, volatilities.reduce((s: number, v: number) => s + v, 0) / volatilities.length);
}

export function computeSignalNoiseRatio(signalResults: any[], confidence: any): number {
  if (signalResults.length === 0) return 0;
  const avgCoverage = signalResults.reduce((s: number, r: any) => s + (r.signalCoverageScore || 0), 0) / signalResults.length;
  const stabilityFactor = confidence.factors?.signalStability || 0.5;
  return Math.round(Math.min(1, avgCoverage * 0.6 + stabilityFactor * 0.4) * 100) / 100;
}

export function computeEvidenceCoverage(signalResults: any[], totalCompetitors: number): EvidenceCoverage {
  const postsAnalyzed = signalResults.reduce((s: number, r: any) => s + (r.sampleSize || 0), 0);
  const commentsAnalyzed = signalResults.reduce((s: number, r: any) => s + (r.commentCount || 0), 0);
  const competitorsWithSufficientData = signalResults.filter((r: any) => (r.sampleSize || 0) >= INSTAGRAM_API_CEILING).length;
  return { postsAnalyzed, commentsAnalyzed: commentsAnalyzed, competitorsWithSufficientData, totalCompetitors };
}

export function buildMarketDiagnosis(confidence: any, trajectory: any, dominantIntent: string): string | null {
  if (confidence.guardDecision === "BLOCK") return null;
  if (confidence.overall < MI_CONFIDENCE.NO_AGGRESSIVE_THRESHOLD) return null;

  const direction = deriveTrajectoryDirection(trajectory);

  if (confidence.guardDecision === "DOWNGRADE") {
    return "Exploratory assessment. Data volume is below confidence thresholds. Current signals are provisional.";
  }

  switch (direction) {
    case "HEATING_COMPRESSED":
      return "Market activity is elevated with narrowing offer price bands. Competitive intensity is increasing across tracked competitors.";
    case "HEATING":
      return "Competitor activity levels are rising. Posting frequency and engagement signals show upward movement across the tracked set.";
    case "COOLING":
      return "Market activity density is currently low. Consistent publisher presence is uncommon across analyzed competitors.";
    case "STABLE_COMPETITIVE":
      return "Short-term competitor motion is low but structural competition is high. The market has multiple established competitors with active content presence. Low activity does not indicate low competition.";
    case "SATURATED":
      return "Content angle overlap is high across competitors. Format experimentation is limited. Most creators are using similar hooks and narratives.";
    case "COMPRESSING":
      return "Offer language is converging across competitors. Pricing signals show narrowing differentiation between tracked accounts.";
    default:
      return "Market activity is at moderate levels. No dominant directional trend detected across the competitive set.";
  }
}

export function buildThreatSignals(confidence: any, trajectory: any, intents: any[], deviations?: DeviationResult[], baselineCalibrated?: boolean, signalClusters?: SignalCluster[]): string[] {
  const threats: string[] = [];

  if (confidence.guardDecision === "BLOCK") {
    threats.push("INSUFFICIENT DATA: Cannot assess threat landscape reliably");
    return threats;
  }

  const aggressiveCompetitors = intents.filter((i: any) =>
    i.intentCategory === "AGGRESSIVE_SCALING" || i.intentCategory === "PRICE_WAR"
  );
  if (aggressiveCompetitors.length > 0) {
    const names = aggressiveCompetitors.map((c: any) => c.competitorName).join(", ");
    threats.push(`${aggressiveCompetitors.length} competitor(s) showing aggressive scaling or price-war signals: ${names}`);
  }

  const positioningShifts = intents.filter((i: any) => i.intentCategory === "POSITIONING_SHIFT");
  if (positioningShifts.length > 0) {
    threats.push(`Positioning shift signals detected across ${positioningShifts.length} competitor(s) — content patterns diverging from prior baseline`);
  }

  const decliningCompetitors = intents.filter((i: any) => i.intentCategory === "DECLINING");
  if (decliningCompetitors.length > 1) {
    threats.push(`Declining activity signals observed across ${decliningCompetitors.length} competitors — posting frequency below historical norms`);
  }

  if (trajectory.narrativeConvergenceScore > 0.6) {
    threats.push(`High narrative convergence (${fmt(trajectory.narrativeConvergenceScore)}) — competitor messaging becoming homogeneous`);
  }

  if (trajectory.angleSaturationLevel > 0.6) {
    threats.push(`High angle saturation (${fmt(trajectory.angleSaturationLevel)}) — content differentiation is decreasing`);
  }

  if (trajectory.competitionIntensityScore > 0.7) {
    threats.push(`Elevated competition intensity (${fmt(trajectory.competitionIntensityScore)}) — market is highly contested`);
  }

  if (baselineCalibrated) {
    const narDev = deviations?.find(d => d.field === "narrativeConvergence");
    if (narDev?.isElevated) {
      threats.push(`Narrative convergence above baseline (${fmt(narDev.observed)} vs ${fmt(narDev.baseline)} baseline)`);
    }
    const angleDev = deviations?.find(d => d.field === "angleSaturation");
    if (angleDev?.isElevated) {
      threats.push(`Hook/angle duplication above baseline (${fmt(angleDev.observed)} vs ${fmt(angleDev.baseline)} baseline)`);
    }
    const offerDev = deviations?.find(d => d.field === "offerCompression");
    if (offerDev?.isElevated) {
      threats.push(`Offer clustering above baseline (${fmt(offerDev.observed)} vs ${fmt(offerDev.baseline)} baseline)`);
    }
    const heatDev = deviations?.find(d => d.field === "marketHeating");
    if (heatDev?.isElevated) {
      threats.push(`Market posting density above baseline (${fmt(heatDev.observed)} vs ${fmt(heatDev.baseline)} baseline)`);
    }
    if (heatDev?.isDepressed) {
      threats.push(`Market posting density below baseline (${fmt(heatDev.observed)} vs ${fmt(heatDev.baseline)} baseline) — low competitive activity`);
    }
    const revDev = deviations?.find(d => d.field === "revivalPotential");
    if (revDev?.isElevated) {
      threats.push(`Revival potential above baseline (${fmt(revDev.observed)} vs ${fmt(revDev.baseline)} baseline) — dormant competitors may re-enter`);
    }
  }

  if (signalClusters && signalClusters.length > 0) {
    const competitorWeaknessClusters = signalClusters.filter(c => c.category === "competitor_weakness" && c.reinforcedScore >= 0.3);
    for (const cluster of competitorWeaknessClusters) {
      threats.push(`Competitor weakness signals detected across ${cluster.competitorCount} competitor(s) — market awareness of deficiencies is spreading`);
    }
    const painClusters = signalClusters.filter(c => c.category === "pain_signal" && c.reinforcedScore >= 0.3);
    for (const cluster of painClusters) {
      threats.push(`Audience pain signals amplified across ${cluster.competitorCount} competitor(s) — unresolved market pain may indicate opportunity or churn risk`);
    }
    const authorityClusters = signalClusters.filter(c => c.category === "authority_positioning" && c.reinforcedScore >= 0.4);
    for (const cluster of authorityClusters) {
      threats.push(`Authority positioning claims from ${cluster.competitorCount} competitor(s) — authority competition intensifying`);
    }
  }

  return threats;
}

export function buildOpportunitySignals(confidence: any, trajectory: any, intents: any[], deviations?: DeviationResult[], baselineCalibrated?: boolean, signalClusters?: SignalCluster[]): string[] {
  const opportunities: string[] = [];

  if (confidence.guardDecision === "BLOCK") {
    return opportunities;
  }

  const decliningCompetitors = intents.filter((i: any) => i.intentCategory === "DECLINING");
  if (decliningCompetitors.length > 0) {
    opportunities.push(`${decliningCompetitors.length} competitor(s) showing declining activity — reduced publishing pressure observed`);
  }

  if (trajectory.narrativeConvergenceScore > 0.5) {
    opportunities.push(`Narrative convergence at ${fmt(trajectory.narrativeConvergenceScore)} — differentiation gaps are widening, unique positioning can stand out`);
  }

  if (trajectory.angleSaturationLevel < 0.3) {
    opportunities.push(`Low angle saturation (${fmt(trajectory.angleSaturationLevel)}) — multiple content formats remain underutilized`);
  }

  if (trajectory.offerCompressionIndex < 0.3) {
    opportunities.push(`Low offer compression (${fmt(trajectory.offerCompressionIndex)}) — pricing differentiation is feasible`);
  }

  if (trajectory.marketHeatingIndex < 0.3) {
    opportunities.push(`Low market activity (${fmt(trajectory.marketHeatingIndex)}) — reduced competitive noise in category`);
  }

  const testingCompetitors = intents.filter((i: any) => i.intentCategory === "TESTING");
  if (testingCompetitors.length >= 2) {
    opportunities.push(`${testingCompetitors.length} competitor(s) in testing mode — market experimentation phase detected, early positioning advantage available`);
  }

  if (baselineCalibrated) {
    const heatDev = deviations?.find(d => d.field === "marketHeating");
    if (heatDev?.isDepressed) {
      opportunities.push(`Market posting density below baseline (${fmt(heatDev.observed)} vs ${fmt(heatDev.baseline)} baseline) — reduced competitive noise`);
    }
    const angleDev = deviations?.find(d => d.field === "angleSaturation");
    if (angleDev?.isDepressed) {
      opportunities.push(`Creative angle diversity above baseline (${fmt(angleDev.observed)} vs ${fmt(angleDev.baseline)} baseline)`);
    }
    const offerDev = deviations?.find(d => d.field === "offerCompression");
    if (offerDev?.isDepressed) {
      opportunities.push(`Offer differentiation above baseline (${fmt(offerDev.observed)} vs ${fmt(offerDev.baseline)} baseline)`);
    }
    const revDev = deviations?.find(d => d.field === "revivalPotential");
    if (revDev && !revDev.isElevated && heatDev && !heatDev.isElevated) {
      opportunities.push("No dormant competitor re-entry signals — market entrant activity is stable");
    }
  }

  if (signalClusters && signalClusters.length > 0) {
    const desireClusters = signalClusters.filter(c => c.category === "desire_signal" && c.reinforcedScore >= 0.3);
    for (const cluster of desireClusters) {
      opportunities.push(`Desire signals detected across ${cluster.competitorCount} competitor audiences — validated demand for transformation outcomes`);
    }
    const transformClusters = signalClusters.filter(c => c.category === "transformation_statement" && c.reinforcedScore >= 0.3);
    for (const cluster of transformClusters) {
      opportunities.push(`Transformation proof across ${cluster.competitorCount} competitor(s) — market responds to evidence-based positioning`);
    }
    const objectionClusters = signalClusters.filter(c => c.category === "audience_objection" && c.reinforcedScore >= 0.3);
    for (const cluster of objectionClusters) {
      opportunities.push(`Common audience objections across ${cluster.competitorCount} competitor(s) — addressable trust/value gaps exist`);
    }
    const diffClusters = signalClusters.filter(c => c.category === "differentiation_narrative" && c.reinforcedScore >= 0.3);
    for (const cluster of diffClusters) {
      opportunities.push(`Differentiation narratives active across ${cluster.competitorCount} competitor(s) — market is receptive to unique positioning`);
    }
    const strategicClusters = signalClusters.filter(c => c.category === "strategic_claim" && c.reinforcedScore >= 0.3);
    for (const cluster of strategicClusters) {
      opportunities.push(`Strategic methodology claims from ${cluster.competitorCount} competitor(s) — framework-based positioning has market traction`);
    }
  }

  return sanitizeOpportunitySignals(opportunities);
}

const OPPORTUNITY_PRESCRIPTIVE_PATTERNS = [
  /\byou should\b/i,
  /\brecommend\b/i,
  /\btry (?:to |using )/i,
  /\bconsider (?:targeting|positioning|using|shifting)/i,
  /\bfocus (?:on |your )/i,
  /\btarget (?:this|these|the|your)/i,
  /\bposition (?:yourself|your brand)/i,
  /\bleverage (?:this|these)/i,
  /\bcreate (?:content|campaigns|ads) (?:that|to|for)/i,
  /\bswitch (?:to|your)/i,
  /\badjust your/i,
  /\boptimize (?:for|your)/i,
];

function sanitizeOpportunitySignals(signals: string[]): string[] {
  return signals.filter(signal => {
    for (const pattern of OPPORTUNITY_PRESCRIPTIVE_PATTERNS) {
      if (pattern.test(signal)) return false;
    }
    return true;
  });
}

function fmt(val: number): string {
  return `${Math.round(val * 100)}%`;
}

export function computeSnapshotDeltas(prevSnapshot: any, currSnapshot: {
  competitorHash: string;
  signalData: any[];
  intentData: any[];
  trajectoryData: any;
  dominanceData: any[];
}): DeltaReport | null {
  if (!prevSnapshot) return null;

  const prevHash = prevSnapshot.competitorHash;
  const currHash = currSnapshot.competitorHash;
  const competitorHashMatch = prevHash === currHash;

  if (!competitorHashMatch) return null;

  const prevSignals: any[] = parseJsonSafe(prevSnapshot.signalData, []);
  const prevIntents: any[] = parseJsonSafe(prevSnapshot.intentData, []);
  const prevTrajectory: any = parseJsonSafe(prevSnapshot.trajectoryData, {});
  const prevDominance: any[] = parseJsonSafe(prevSnapshot.dominanceData, []);

  const currSignals = currSnapshot.signalData;
  const currIntents = currSnapshot.intentData;
  const currTrajectory = currSnapshot.trajectoryData;
  const currDominance = currSnapshot.dominanceData;

  const signalDeltas: SignalDelta[] = [];
  const signalFields = [
    "postingFrequencyTrend", "engagementVolatility", "ctaIntensityShift",
    "offerLanguageChange", "hashtagDriftScore", "bioModificationFrequency",
    "sentimentDrift", "reviewVelocityChange", "contentExperimentRate",
  ];

  for (const curr of currSignals) {
    const prev = prevSignals.find((p: any) => p.competitorId === curr.competitorId);
    if (!prev) continue;
    for (const field of signalFields) {
      const prevVal = prev.signals?.[field] ?? 0;
      const currVal = curr.signals?.[field] ?? 0;
      const delta = currVal - prevVal;
      if (Math.abs(delta) > 0.001) {
        signalDeltas.push({
          competitorId: curr.competitorId,
          competitorName: curr.competitorName,
          signalField: field,
          previous: prevVal,
          current: currVal,
          delta,
        });
      }
    }
  }

  const intentChanges: IntentChange[] = [];
  for (const curr of currIntents) {
    const prev = prevIntents.find((p: any) => p.competitorId === curr.competitorId);
    if (!prev) continue;
    intentChanges.push({
      competitorId: curr.competitorId,
      competitorName: curr.competitorName,
      previousIntent: prev.intentCategory,
      currentIntent: curr.intentCategory,
      changed: prev.intentCategory !== curr.intentCategory,
    });
  }

  const trajectoryFields = [
    "marketHeatingIndex", "narrativeConvergenceScore",
    "offerCompressionIndex", "angleSaturationLevel", "revivalPotential",
  ];
  const trajectoryDeltas: TrajectoryDelta[] = [];
  for (const field of trajectoryFields) {
    const prevVal = prevTrajectory[field] ?? 0;
    const currVal = currTrajectory[field] ?? 0;
    const delta = currVal - prevVal;
    if (Math.abs(delta) > 0.001) {
      trajectoryDeltas.push({ field, previous: prevVal, current: currVal, delta });
    }
  }

  const dominanceChanges: DominanceChange[] = [];
  for (const curr of currDominance) {
    const prev = prevDominance.find((p: any) => p.competitorId === curr.competitorId);
    if (!prev) continue;
    const scoreDelta = (curr.dominanceScore ?? 0) - (prev.dominanceScore ?? 0);
    dominanceChanges.push({
      competitorId: curr.competitorId,
      competitorName: curr.competitorName,
      previousScore: prev.dominanceScore ?? 0,
      currentScore: curr.dominanceScore ?? 0,
      previousLevel: prev.dominanceLevel ?? "UNKNOWN",
      currentLevel: curr.dominanceLevel ?? "UNKNOWN",
      scoreDelta,
      levelChanged: prev.dominanceLevel !== curr.dominanceLevel,
    });
  }

  const hasMeaningfulChanges =
    signalDeltas.length > 0 ||
    intentChanges.some(c => c.changed) ||
    trajectoryDeltas.length > 0 ||
    dominanceChanges.some(c => c.levelChanged || Math.abs(c.scoreDelta) >= 1);

  return {
    signalDeltas,
    intentChanges,
    trajectoryDeltas,
    dominanceChanges,
    competitorHashMatch,
    hasMeaningfulChanges,
  };
}

export class MarketIntelligenceV3 {
  static async run(
    mode: MIv3Mode,
    accountId: string,
    campaignId: string,
    forceRefresh: boolean = false,
    goalMode: GoalMode = "STRATEGY_MODE",
  ): Promise<MIv3DiagnosticResult> {
    const lockKey = `${accountId}:${campaignId}`;

    const existingLock = activeLocks.get(lockKey);
    if (existingLock) {
      console.log(`[MIv3] Concurrent run detected for ${lockKey}, waiting for existing run`);
      return existingLock;
    }

    const runPromise = this._executeRun(mode, accountId, campaignId, forceRefresh, goalMode);
    activeLocks.set(lockKey, runPromise);

    try {
      const result = await runPromise;
      return result;
    } finally {
      activeLocks.delete(lockKey);
    }
  }

  private static async _executeRun(
    mode: MIv3Mode,
    accountId: string,
    campaignId: string,
    forceRefresh: boolean,
    goalMode: GoalMode = "STRATEGY_MODE",
  ): Promise<MIv3DiagnosticResult> {
    if (!goalMode || goalMode === "STRATEGY_MODE") {
      const campaignRows = await db.select().from(growthCampaigns).where(eq(growthCampaigns.id, campaignId)).limit(1);
      if (campaignRows[0]?.goalMode === "REACH_MODE") {
        goalMode = "REACH_MODE";
      }
    }

    console.log(`[MIv3] MARKET_OVERVIEW_DIAGNOSTIC_RUN | mode=${mode} | accountId=${accountId} | campaignId=${campaignId} | goalMode=${goalMode}`);

    logAudit("MARKET_OVERVIEW_DIAGNOSTIC_RUN", {
      mode,
      accountId,
      campaignId,
      caller: ISOLATION_ALLOWED_CALLER,
    }).catch(() => {});

    const allCompetitors = await getCompetitorData(accountId, campaignId);
    const competitors = allCompetitors.filter(c => {
      const postCount = c.posts?.length || 0;
      if (postCount === 0) {
        console.log(`[MIv3] SCRAPING_RESILIENCE: skipping competitor ${c.name} (${c.id.slice(0, 8)}) — 0 posts, marked temporarily unavailable`);
        return false;
      }
      return true;
    });
    if (competitors.length === 0 && allCompetitors.length > 0) {
      console.log(`[MIv3] SCRAPING_RESILIENCE: all ${allCompetitors.length} competitors have 0 posts — cannot proceed`);
    }
    const competitorHash = computeCompetitorHash(competitors);

    let cacheInvalidationReason: import("./types").CacheInvalidationReason = null;

    if (!forceRefresh) {
      const cacheResult = await getCachedSnapshot(accountId, campaignId, competitorHash);
      if (cacheResult.snapshot) {
        console.log(`[MIv3] Returning cached snapshot ${cacheResult.snapshot.id}`);
        return buildResultFromSnapshot(cacheResult.snapshot);
      }
      cacheInvalidationReason = cacheResult.invalidationReason;
    }

    const totalPosts = competitors.reduce((s, c) => s + (c.posts?.length || 0), 0);
    const totalComments = competitors.reduce((s, c) => s + (c.comments?.length || 0), 0);
    const tokenBudget = computeTokenBudget(competitors.length, totalComments, totalPosts);
    const executionMode = tokenBudget.selectedMode;

    for (const comp of competitors) {
      const { sampledPosts, sampledComments } = applySampling(
        comp.posts || [], comp.comments || [], executionMode
      );
      comp.posts = sampledPosts;
      comp.comments = sampledComments;
    }

    const signalResults = computeAllSignals(competitors);
    const contentDnaResults = computeAllContentDNA(competitors);
    const dataFreshnessDays = computeDataFreshnessDays(competitors);
    const intents = classifyAllIntents(signalResults);
    const authorityWeightMap: Record<string, number> = {};
    for (const sr of signalResults) {
      authorityWeightMap[sr.competitorId] = sr.authorityWeight;
    }
    const dominantIntent = computeDominantMarketIntent(intents, authorityWeightMap);
    const allComments = competitors.flatMap(c => c.comments || []);
    const allPosts = competitors.flatMap(c => c.posts || []);
    const engagementQuality = classifyEngagementQuality(allComments, allPosts);
    const audienceIntentSignals = detectAudienceIntentSignals(allComments);
    const realDataRatio = allComments.length > 0 ? computeRealDataRatio(allComments) : (allPosts.length > 0 ? 1.0 : 0);
    const sampleBias = detectSampleBias(signalResults);
    if (sampleBias.hasBias) {
      console.log(`[MIv3] SAMPLE_BIAS_DETECTED | flags=${sampleBias.biasFlags.join("; ")} | biasScore=${sampleBias.biasScore}`);
    }
    const totalCommentCount = allPosts.reduce((sum, p) => sum + (p.comments || 0), 0);
    const demandPressure = computeDemandPressure(allComments, engagementQuality, audienceIntentSignals, totalCommentCount);
    const echoChamber = detectEchoChamber(signalResults);
    if (echoChamber.isEchoChamber) {
      console.log(`[MIv3] ECHO_CHAMBER_DETECTED | risk=${echoChamber.echoChamberRisk} | convergence=${echoChamber.convergenceScore} | diversity=${echoChamber.diversityScore} | penalty=${echoChamber.penalty}`);
    }
    console.log(`[MIv3] DEMAND_PRESSURE | score=${demandPressure.score} | level=${demandPressure.level} | engagement=${demandPressure.components.engagementDensity} | intent=${demandPressure.components.intentSignalStrength} | purchase=${demandPressure.components.purchaseIntentDensity}`);
    const trajectory = computeTrajectory(signalResults, intents, engagementQuality);
    if (echoChamber.penalty > 0) {
      trajectory.angleSaturationLevel = Math.max(0, trajectory.angleSaturationLevel - echoChamber.penalty);
      trajectory.narrativeConvergenceScore = Math.min(1, trajectory.narrativeConvergenceScore + echoChamber.penalty);
      console.log(`[MIv3] ECHO_CHAMBER_PENALTY_APPLIED | saturation=${trajectory.angleSaturationLevel.toFixed(3)} | convergence=${trajectory.narrativeConvergenceScore.toFixed(3)}`);
    }
    const contentPrimaryMode = allComments.length === 0 && allPosts.length > 0;
    const confidence = computeConfidence(signalResults, dataFreshnessDays, realDataRatio, contentPrimaryMode);
    const dominanceResults = computeAllDominance(signalResults, confidence, goalMode);
    const missingFlags = aggregateMissingFlags(signalResults);
    const volatilityIndex = computeVolatilityIndex(signalResults);
    const trajectoryDirection = deriveTrajectoryDirection(trajectory, demandPressure.score);
    const marketState = deriveMarketState(trajectory, confidence.level, demandPressure.score);
    const marketDiagnosis = buildMarketDiagnosis(confidence, trajectory, dominantIntent);
    const marketBaseline = await computeMarketBaseline(accountId, campaignId);
    const signalNoiseRatio = computeSignalNoiseRatio(signalResults, confidence);
    const evidenceCoverage = computeEvidenceCoverage(signalResults, competitors.length);
    const calibrationCtx: CalibrationContext = {
      signalNoiseRatio,
      confidenceScore: confidence.overall,
      postsAnalyzed: evidenceCoverage.postsAnalyzed,
      competitorCoverage: competitors.length > 0 ? evidenceCoverage.competitorsWithSufficientData / competitors.length : 0,
    };
    const deviations = computeAllDeviations(trajectory, marketBaseline, calibrationCtx);
    console.log(`[MIv3] Baseline calibration: calibrated=${marketBaseline.isCalibrated}, snapshotsUsed=${marketBaseline.snapshotsUsed}, deviations=${deviations.filter(d => d.isElevated || d.isDepressed).length} triggered, effectiveThreshold=${deviations[0]?.effectiveThreshold?.toFixed(2) ?? "N/A"}`);

    const signalClusters = clusterSemanticSignals(signalResults);
    const totalSemanticSignals = signalResults.reduce((s, r) => s + r.semanticSignals.length, 0);
    console.log(`[MIv3] SEMANTIC_SIGNALS | total=${totalSemanticSignals} | clusters=${signalClusters.length} | reinforced=${signalClusters.filter(c => c.reinforcedScore >= 0.3).length}`);

    const narrativeObjectionMap = extractNarrativeObjections(competitors);
    console.log(`[MIv3] NARRATIVE_OBJECTIONS | total=${narrativeObjectionMap.totalObjectionsDetected} | multiCompetitor=${narrativeObjectionMap.objectionsFromMultipleCompetitors} | density=${narrativeObjectionMap.objectionDensity} | captions=${narrativeObjectionMap.captionsScanned}`);

    const threatSignals = buildThreatSignals(confidence, trajectory, intents, deviations, marketBaseline.isCalibrated, signalClusters);
    const opportunitySignals = buildOpportunitySignals(confidence, trajectory, intents, deviations, marketBaseline.isCalibrated, signalClusters);
    const similarityData = computeSimilarityDiagnosis(competitors, signalResults);

    const numericalSignals = signalResults.reduce((s, r) => s + Object.values(r.signals).filter(v => Math.abs(v) > 0.01).length, 0);
    const filteredSignals = signalResults.reduce((s, r) => s + r.missingFields.length, 0);
    const pipelineDiagnostics: SignalPipelineDiagnostics = {
      stage1_rawData: { postsProcessed: totalPosts, competitorsProcessed: competitors.length },
      stage2_extraction: { numericalSignals, semanticSignals: totalSemanticSignals, audienceIntentSignals: audienceIntentSignals.length },
      stage3_filtered: { signalsRemoved: filteredSignals, filterReasons: signalResults.flatMap(r => r.missingFields.map(f => `${r.competitorName}: ${f}`)).slice(0, 20) },
      stage4_aggregation: { clustersFormed: signalClusters.length, reinforcedSignals: signalClusters.filter(c => c.reinforcedScore >= 0.3).length },
      stage5_final: { threatSignals: threatSignals.length, opportunitySignals: opportunitySignals.length, totalUsed: Math.max(0, numericalSignals - filteredSignals) + totalSemanticSignals },
    };
    console.log(`[MIv3] PIPELINE_DIAGNOSTICS | stage1: ${pipelineDiagnostics.stage1_rawData.postsProcessed} posts/${pipelineDiagnostics.stage1_rawData.competitorsProcessed} competitors | stage2: ${pipelineDiagnostics.stage2_extraction.numericalSignals} numerical + ${pipelineDiagnostics.stage2_extraction.semanticSignals} semantic + ${pipelineDiagnostics.stage2_extraction.audienceIntentSignals} audience | stage3: ${pipelineDiagnostics.stage3_filtered.signalsRemoved} filtered | stage4: ${pipelineDiagnostics.stage4_aggregation.clustersFormed} clusters | stage5: ${pipelineDiagnostics.stage5_final.threatSignals} threats + ${pipelineDiagnostics.stage5_final.opportunitySignals} opportunities`);

    const signalDiagnostics = logSignalDiagnostics("MARKET_INTELLIGENCE_V3", {
      postsProcessed: totalPosts,
      signalsDetected: numericalSignals + totalSemanticSignals,
      signalsFiltered: filteredSignals,
      signalsUsed: Math.max(0, numericalSignals - filteredSignals) + totalSemanticSignals,
    });

    const competitorNarratives = competitors.map(c => {
      const parts: string[] = [];
      if (c.messagingTone) parts.push(c.messagingTone);
      if (c.hookStyles) parts.push(c.hookStyles);
      if (c.ctaPatterns) parts.push(c.ctaPatterns);
      const topCaptions = (c.posts || []).slice(0, 5).map(p => p.caption || "").filter(Boolean);
      parts.push(...topCaptions);
      return parts.join(" ");
    }).filter(n => n.length > 0);

    const narrativeOverlap = detectNarrativeOverlap(competitorNarratives);
    if (narrativeOverlap.overlapDetected) {
      console.log(`[MIv3] NARRATIVE_OVERLAP | score=${narrativeOverlap.overlapScore.toFixed(3)} | duplicates=${narrativeOverlap.duplicateNarratives.length} | saturationPenalty=${narrativeOverlap.saturationPenalty.toFixed(3)}`);
    }

    if (narrativeOverlap.saturationPenalty > 0) {
      confidence.overall = Math.max(0, confidence.overall - narrativeOverlap.saturationPenalty);
      console.log(`[MIv3] SATURATION_PENALTY_APPLIED | newConfidence=${confidence.overall.toFixed(3)} | penalty=${narrativeOverlap.saturationPenalty.toFixed(3)}`);
    }

    if (narrativeOverlap.overlapDetected) {
      threatSignals.push(...narrativeOverlap.warnings);
    }

    const previousSnapshots = await db.select().from(miSnapshots)
      .where(and(
        eq(miSnapshots.accountId, accountId),
        eq(miSnapshots.campaignId, campaignId),
        eq(miSnapshots.status, "COMPLETE"),
      ))
      .orderBy(desc(miSnapshots.createdAt))
      .limit(1);

    const previousSnapshot = previousSnapshots[0] || null;
    let confirmedRuns = (previousSnapshot?.confirmedRuns || 0);
    let previousDirection = previousSnapshot?.previousDirection || null;
    let directionLockedUntil = previousSnapshot?.directionLockedUntil || null;

    const now = new Date();
    if (previousDirection && previousDirection !== trajectoryDirection) {
      if (directionLockedUntil && now < new Date(directionLockedUntil)) {
        console.log(`[MIv3] Direction change blocked: locked until ${directionLockedUntil}`);
      } else {
        confirmedRuns = 1;
        directionLockedUntil = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      }
    } else {
      confirmedRuns++;
    }

    const twoRunStatus: TwoRunConfirmation = {
      confirmedRuns,
      isConfirmed: confirmedRuns >= 2,
      previousDirection,
      currentDirection: trajectoryDirection,
      directionStable: previousDirection === trajectoryDirection || previousDirection === null,
    };

    const telemetry: TelemetryRecord = {
      executionMode,
      projectedTokens: tokenBudget.projectedTokens,
      actualTokensUsed: 0,
      competitorsCount: competitors.length,
      commentSampleSize: totalComments,
      postSampleSize: totalPosts,
      downgradeReason: tokenBudget.downgradeReason,
      postsProcessed: totalPosts,
      commentsProcessed: totalComments,
      refreshReason: forceRefresh ? "MANUAL_REFRESH" : "SCHEDULED",
    };

    let narrativeSynthesis: string | null = null;
    if (executionMode !== "LIGHT" && confidence.guardDecision !== "BLOCK") {
      try {
        narrativeSynthesis = buildMarketSummary(marketState, trajectoryDirection, dominantIntent, confidence, intents, deriveCompetitionIntensityLevel(trajectory.competitionIntensityScore));
        telemetry.actualTokensUsed = 0;
      } catch (err) {
        console.error(`[MIv3] Narrative synthesis failed, returning deterministic only:`, err);
        narrativeSynthesis = null;
      }
    }

    const deltaReport = computeSnapshotDeltas(
      previousSnapshot?.status === "COMPLETE" ? previousSnapshot : null,
      {
        competitorHash,
        signalData: signalResults,
        intentData: intents,
        trajectoryData: trajectory,
        dominanceData: dominanceResults,
      }
    );

    const audiencePressureSignal = Math.round(
      (demandPressure.components.intentSignalStrength * 0.4 +
       demandPressure.components.objectionDensity * 0.3 +
       demandPressure.components.purchaseIntentDensity * 0.3) * 1000
    ) / 1000;

    const diagnostics: MIDiagnostics = {
      activityScore: trajectory.marketActivityLevel,
      competitionIntensityScore: trajectory.competitionIntensityScore,
      demandScore: trajectory.demandConfidence,
      narrativeSaturationScore: trajectory.angleSaturationLevel,
      competitorWeights: signalResults.map(sr => ({
        competitorId: sr.competitorId,
        competitorName: sr.competitorName,
        authorityWeight: sr.authorityWeight,
        lifecycle: sr.lifecycle,
      })),
      sampleBiasFlag: sampleBias.hasBias,
      realCommentRatio: realDataRatio,
      demandPressureScore: demandPressure.score,
      narrativeConvergenceScore: echoChamber.convergenceScore,
      audiencePressureSignal,
      echoChamberRisk: echoChamber.echoChamberRisk,
    };
    console.log(`[MIv3] DIAGNOSTICS | activity=${diagnostics.activityScore.toFixed(3)} | intensity=${diagnostics.competitionIntensityScore.toFixed(3)} | demand=${diagnostics.demandScore.toFixed(3)} | saturation=${diagnostics.narrativeSaturationScore.toFixed(3)} | sampleBias=${diagnostics.sampleBiasFlag} | realRatio=${diagnostics.realCommentRatio} | demandPressure=${diagnostics.demandPressureScore} | echoChamber=${diagnostics.echoChamberRisk}`);

    const miLineage: SignalLineageEntry[] = [];
    opportunitySignals.forEach((sig: any, i: number) => {
      const text = typeof sig === "string" ? sig : (sig?.signal || sig?.description || sig?.message || "");
      if (text) miLineage.push(createSourceLineageEntry("market_intelligence", "market_opportunity", text, i));
    });
    threatSignals.forEach((sig: any, i: number) => {
      const text = typeof sig === "string" ? sig : (sig?.signal || sig?.description || sig?.message || "");
      if (text) miLineage.push(createSourceLineageEntry("market_intelligence", "market_threat", text, i));
    });
    const narObjections = narrativeObjectionMap?.objections || [];
    narObjections.forEach((obj: any, i: number) => {
      if (obj?.objection) miLineage.push(createSourceLineageEntry("market_intelligence", "narrative_objection", obj.objection, i));
    });
    console.log(`[MIv3] LINEAGE_GENERATED | entries=${miLineage.length} | opportunities=${opportunitySignals.length} | threats=${threatSignals.length} | narrativeObj=${narObjections.length}`);

    const snapshotPayload = {
      accountId,
      campaignId,
      competitorHash,
      version: (previousSnapshot?.version || 0) + 1,
      competitorData: JSON.stringify(competitors.map(c => ({ id: c.id, name: c.name }))),
      signalData: JSON.stringify(signalResults),
      intentData: JSON.stringify(intents),
      trajectoryData: JSON.stringify(trajectory),
      dominanceData: JSON.stringify(dominanceResults),
      confidenceData: JSON.stringify(confidence),
      marketState,
      executionMode,
      snapshotSource: "FRESH_DATA" as const,
      fetchExecuted: true,
      telemetry: JSON.stringify({ ...telemetry, snapshotSource: "FRESH_DATA", fetchExecuted: true }),
      narrativeSynthesis,
      marketDiagnosis,
      threatSignals: JSON.stringify(threatSignals),
      opportunitySignals: JSON.stringify(opportunitySignals),
      missingSignalFlags: JSON.stringify(missingFlags),
      similarityData: JSON.stringify(similarityData),
      contentDnaData: JSON.stringify(contentDnaResults),
      deltaReport: deltaReport ? JSON.stringify(deltaReport) : null,
      diagnosticsData: JSON.stringify(diagnostics),
      objectionMapData: JSON.stringify(narrativeObjectionMap),
      signalLineage: JSON.stringify(miLineage),
      volatilityIndex,
      dataFreshnessDays,
      overallConfidence: confidence.overall,
      confidenceLevel: confidence.level,
      analysisVersion: ENGINE_VERSION,
      status: "COMPLETE" as const,
      confirmedRuns,
      previousDirection: trajectoryDirection,
      directionLockedUntil: directionLockedUntil ? new Date(directionLockedUntil) : null,
      goalMode,
    };

    const snapshot = await persistValidatedSnapshot(snapshotPayload, "engine._executeRun");

    for (const sr of signalResults) {
      await db.insert(miSignalLogs).values({
        snapshotId: snapshot.id,
        competitorId: sr.competitorId,
        signals: JSON.stringify(sr.signals),
        signalCoverageScore: sr.signalCoverageScore,
        sourceReliabilityScore: sr.sourceReliabilityScore,
        sampleSize: sr.sampleSize,
        timeWindowDays: sr.timeWindowDays,
        varianceScore: sr.varianceScore,
        dominantSourceRatio: sr.dominantSourceRatio,
        missingFields: JSON.stringify(sr.missingFields),
      });
    }

    await db.insert(miTelemetry).values({
      snapshotId: snapshot.id,
      executionMode: telemetry.executionMode,
      projectedTokens: telemetry.projectedTokens,
      actualTokensUsed: telemetry.actualTokensUsed,
      competitorsCount: telemetry.competitorsCount,
      commentSampleSize: telemetry.commentSampleSize,
      postSampleSize: telemetry.postSampleSize,
      downgradeReason: telemetry.downgradeReason,
      postsProcessed: telemetry.postsProcessed,
      commentsProcessed: telemetry.commentsProcessed,
      refreshReason: telemetry.refreshReason,
    });

    const output: MIv3Output = {
      marketState,
      dominantIntentType: dominantIntent,
      competitorIntentMap: intents,
      trajectoryDirection,
      narrativeSaturationLevel: trajectory.angleSaturationLevel,
      revivalPotential: trajectory.revivalPotential,
      marketDiagnosis,
      threatSignals,
      opportunitySignals,
      confidence,
      missingSignalFlags: missingFlags,
      dataFreshnessDays,
      volatilityIndex,
      signalNoiseRatio,
      evidenceCoverage,
      engagementQuality,
      marketActivityLevel: trajectory.marketActivityLevel,
      demandConfidence: trajectory.demandConfidence,
      competitionIntensityScore: trajectory.competitionIntensityScore,
      competitionIntensityLevel: deriveCompetitionIntensityLevel(trajectory.competitionIntensityScore),
      audienceIntentSignals,
    };

    const guard = await import("./confidence-engine").then(m => m.evaluateSignalStabilityGuard(signalResults, contentPrimaryMode));

    return {
      output,
      snapshotId: snapshot.id,
      snapshotStatus: snapshot.status === "COMPLETE" ? "COMPLETE" as const : "PARTIAL" as const,
      executionMode,
      goalMode,
      telemetry,
      dominanceData: dominanceResults,
      trajectoryData: trajectory,
      signalGuard: guard,
      twoRunStatus,
      similarityData,
      contentDnaData: contentDnaResults,
      deltaReport,
      diagnostics,
      signalDiagnostics,
      narrativeOverlap,
      narrativeObjectionMap,
      cached: false,
      cacheInvalidationReason,
      snapshotSource: "FRESH_DATA" as const,
      fetchExecuted: true,
      timestamp: new Date().toISOString(),
      dataStatus: "LIVE" as const,
    };
  }
}

export function buildResultFromSnapshot(snapshot: any): MIv3DiagnosticResult {
  const signalData = parseJsonSafe(snapshot.signalData, []);
  const intentData = parseJsonSafe(snapshot.intentData, []);
  const trajectoryData = parseJsonSafe(snapshot.trajectoryData, {
    marketHeatingIndex: 0,
    narrativeConvergenceScore: 0,
    offerCompressionIndex: 0,
    angleSaturationLevel: 0,
    revivalPotential: 0,
    marketActivityLevel: 0,
    demandConfidence: 0,
    competitionIntensityScore: 0,
  });
  const dominanceData = parseJsonSafe(snapshot.dominanceData, []);
  const confidenceData = parseJsonSafe(snapshot.confidenceData, {
    overall: 0,
    level: "INSUFFICIENT",
    factors: {},
    guardDecision: "BLOCK",
    guardReasons: ["Cached snapshot"],
  });
  const telemetry = parseJsonSafe(snapshot.telemetry, {
    executionMode: snapshot.executionMode,
    projectedTokens: 0,
    actualTokensUsed: 0,
    competitorsCount: 0,
    commentSampleSize: 0,
    postSampleSize: 0,
    downgradeReason: null,
    postsProcessed: 0,
    commentsProcessed: 0,
    refreshReason: null,
  });
  const threatSignals = parseJsonSafe(snapshot.threatSignals, []);
  const opportunitySignals = parseJsonSafe(snapshot.opportunitySignals, []);
  const missingFlags = parseJsonSafe(snapshot.missingSignalFlags, []);
  const similarityData = parseJsonSafe(snapshot.similarityData, null);
  const deltaReportData = parseJsonSafe(snapshot.deltaReport, null);

  const output: MIv3Output = {
    marketState: snapshot.marketState || "INSUFFICIENT_DATA",
    dominantIntentType: intentData[0]?.intentCategory || "STABLE_DOMINANT",
    competitorIntentMap: intentData,
    trajectoryDirection: snapshot.previousDirection || "STABLE",
    narrativeSaturationLevel: trajectoryData.angleSaturationLevel || 0,
    revivalPotential: trajectoryData.revivalPotential || 0,
    marketDiagnosis: snapshot.marketDiagnosis || null,
    threatSignals,
    opportunitySignals,
    confidence: confidenceData,
    missingSignalFlags: missingFlags,
    dataFreshnessDays: snapshot.dataFreshnessDays || 0,
    volatilityIndex: snapshot.volatilityIndex || 0,
    signalNoiseRatio: confidenceData.factors?.signalStability ? Math.round(Math.min(1, (confidenceData.overall || 0) * 0.6 + (confidenceData.factors.signalStability || 0.5) * 0.4) * 100) / 100 : 0,
    evidenceCoverage: {
      postsAnalyzed: telemetry.postsProcessed || 0,
      commentsAnalyzed: telemetry.commentsProcessed || 0,
      competitorsWithSufficientData: telemetry.competitorsCount || 0,
      totalCompetitors: telemetry.competitorsCount || 0,
    },
    engagementQuality: { highIntentCount: 0, lowValueCount: 0, engagementQualityRatio: 0 },
    marketActivityLevel: trajectoryData.marketActivityLevel || 0,
    demandConfidence: trajectoryData.demandConfidence || 0,
    competitionIntensityScore: trajectoryData.competitionIntensityScore || 0,
    competitionIntensityLevel: deriveCompetitionIntensityLevel(trajectoryData.competitionIntensityScore || 0),
    audienceIntentSignals: [],
  };

  return {
    output,
    snapshotId: snapshot.id,
    snapshotStatus: (snapshot.status === "COMPLETE" ? "COMPLETE" : "PARTIAL") as "COMPLETE" | "PARTIAL",
    executionMode: snapshot.executionMode as ExecutionMode,
    goalMode: (snapshot.goalMode as GoalMode) || "STRATEGY_MODE",
    telemetry,
    dominanceData,
    trajectoryData,
    signalGuard: {
      signalCoverageScore: 0,
      sourceReliabilityScore: 0,
      sampleSize: 0,
      timeWindowDays: 0,
      varianceScore: 0,
      dominantSourceRatio: 0,
      missingFields: [],
      decision: confidenceData.guardDecision || "BLOCK",
      reasons: confidenceData.guardReasons || [],
    },
    twoRunStatus: {
      confirmedRuns: snapshot.confirmedRuns || 0,
      isConfirmed: (snapshot.confirmedRuns || 0) >= 2,
      previousDirection: snapshot.previousDirection,
      currentDirection: snapshot.previousDirection || "STABLE",
      directionStable: true,
    },
    similarityData,
    contentDnaData: parseJsonSafe(snapshot.contentDnaData, null),
    deltaReport: deltaReportData,
    diagnostics: parseJsonSafe(snapshot.diagnosticsData, null),
    signalDiagnostics: null,
    narrativeOverlap: null,
    narrativeObjectionMap: parseJsonSafe(snapshot.objectionMapData, null),
    cached: true,
    cacheInvalidationReason: null,
    snapshotSource: (snapshot.snapshotSource as "FRESH_DATA" | "CACHED_DATA") || "FRESH_DATA",
    fetchExecuted: snapshot.fetchExecuted ?? true,
    timestamp: snapshot.createdAt?.toISOString?.() || new Date().toISOString(),
    dataStatus: (snapshot.dataStatus as "LIVE" | "ENRICHING" | "COMPLETE") || "COMPLETE",
  };
}

export function buildMarketSummary(
  marketState: string,
  direction: string,
  dominantIntent: string,
  confidence: any,
  intents: any[],
  competitionIntensityLevel?: string,
): string {
  const parts: string[] = [];

  parts.push(`Market State: ${marketState}.`);
  parts.push(`Trajectory: ${direction}.`);
  if (competitionIntensityLevel) {
    parts.push(`Competition Intensity: ${competitionIntensityLevel}.`);
  }
  parts.push(`Dominant competitor intent: ${dominantIntent}.`);
  parts.push(`Confidence: ${confidence.level} (${(confidence.overall * 100).toFixed(1)}%).`);

  if (confidence.guardDecision === "DOWNGRADE") {
    parts.push("EXPLORATORY MODE: Data insufficient for confident market assessment.");
  }

  const intentSummary = intents.map((i: any) => `${i.competitorName}: ${i.intentCategory}`).join(", ");
  if (intentSummary) parts.push(`Intent breakdown: ${intentSummary}.`);

  return parts.join(" ");
}

export { validateEngineIsolation, validateDomainOwnership, rejectBlockedEngine, assertSnapshotReadOnly, assertNoPlanWrites, assertNoOrchestrator, assertNoAutopilot, assertNoComputeFromExternal, getProtectedDomains, getBlockedEngines } from "./isolation-guard";
