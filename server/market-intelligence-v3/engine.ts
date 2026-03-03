import { db } from "../db";
import { miSnapshots, miSignalLogs, miTelemetry, ciCompetitors } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { computeAllSignals, aggregateMissingFlags } from "./signal-engine";
import { classifyAllIntents, computeDominantMarketIntent } from "./intent-engine";
import { computeTrajectory, deriveTrajectoryDirection, deriveMarketState } from "./trajectory-engine";
import { computeConfidence } from "./confidence-engine";
import { computeAllDominance } from "./dominance-module";
import { computeTokenBudget, applySampling } from "./token-budget";
import type {
  MIv3Mode,
  MIv3Output,
  MIv3DiagnosticResult,
  CompetitorInput,
  TelemetryRecord,
  TwoRunConfirmation,
  ExecutionMode,
} from "./types";
import { MI_CONFIDENCE, ENGINE_VERSION } from "./constants";
import { validateEngineIsolation } from "./isolation-guard";
import { logAudit } from "../audit";
import { computeCompetitorHash, parseJsonSafe } from "./utils";
import { getStoredPostsForMIv3, getStoredCommentsForMIv3 } from "../competitive-intelligence/data-acquisition";

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
  entryStrategy?: string | null;
  defensiveRisks?: string | null;
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

  const defensiveRisks = parseJsonSafe(snapshot.defensiveRisks, null);
  if (defensiveRisks === null) {
    failures.push("defensiveRisks is null (must be array, even if empty)");
  }

  const signalData = parseJsonSafe(snapshot.signalData, null);
  if (!signalData || (Array.isArray(signalData) && signalData.length === 0)) {
    failures.push("signalData is missing or empty");
  }

  const intentData = parseJsonSafe(snapshot.intentData, null);
  if (!intentData || (Array.isArray(intentData) && intentData.length === 0)) {
    failures.push("intentData is missing or empty");
  }

  const isLowConfidence = confidenceData &&
    (confidenceData.guardDecision === "BLOCK" || confidenceData.guardDecision === "DOWNGRADE" ||
     confidenceData.overall < MI_CONFIDENCE.NO_AGGRESSIVE_THRESHOLD);

  if (!isLowConfidence) {
    if (!snapshot.entryStrategy) {
      failures.push("entryStrategy is null (required when confidence is not BLOCK/DOWNGRADE)");
    }
    if (!snapshot.narrativeSynthesis) {
      failures.push("narrativeSynthesis is null (required when confidence is not BLOCK/DOWNGRADE)");
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

async function getCompetitorData(accountId: string): Promise<CompetitorInput[]> {
  const competitors = await db.select().from(ciCompetitors)
    .where(and(eq(ciCompetitors.accountId, accountId), eq(ciCompetitors.isActive, true)));

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

async function getCachedSnapshot(accountId: string, campaignId: string, competitorHash: string): Promise<any | null> {
  const snapshots = await db.select().from(miSnapshots)
    .where(and(
      eq(miSnapshots.accountId, accountId),
      eq(miSnapshots.campaignId, campaignId),
      eq(miSnapshots.status, "COMPLETE"),
    ))
    .orderBy(desc(miSnapshots.createdAt))
    .limit(1);

  if (snapshots.length === 0) return null;

  const snapshot = snapshots[0];

  if (snapshot.competitorHash && snapshot.competitorHash !== competitorHash) {
    console.log(`[MIv3] Snapshot invalidated: competitor set changed (${snapshot.competitorHash} → ${competitorHash})`);
    return null;
  }

  const snapshotVersion = snapshot.analysisVersion || 0;
  if (snapshotVersion !== ENGINE_VERSION) {
    console.log(`[MIv3] Snapshot invalidated: version mismatch (snapshot=${snapshotVersion}, engine=${ENGINE_VERSION})`);
    return null;
  }

  if (!isSnapshotAnalyticallyComplete(snapshot)) {
    return null;
  }

  const age = Date.now() - new Date(snapshot.createdAt!).getTime();
  const freshnessMs = SNAPSHOT_FRESHNESS_HOURS * 60 * 60 * 1000;

  if (age > freshnessMs) return null;

  return snapshot;
}

function computeDataFreshnessDays(competitors: CompetitorInput[]): number {
  if (competitors.length === 0) return 999;
  const now = Date.now();
  let oldest = now;
  for (const c of competitors) {
    for (const p of c.posts || []) {
      const t = new Date(p.timestamp).getTime();
      if (!isNaN(t) && t < oldest) oldest = t;
    }
  }
  if (oldest === now) return 0;
  return Math.round((now - oldest) / (1000 * 60 * 60 * 24));
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

export function buildEntryStrategy(confidence: any, trajectory: any, dominantIntent: string): string | null {
  if (confidence.guardDecision === "BLOCK") return null;
  if (confidence.overall < MI_CONFIDENCE.NO_AGGRESSIVE_THRESHOLD) return null;

  const direction = deriveTrajectoryDirection(trajectory);

  if (confidence.guardDecision === "DOWNGRADE") {
    return "Exploratory Mode: Insufficient data for strategic recommendations. Focus on data collection.";
  }

  switch (direction) {
    case "HEATING_COMPRESSED":
      return "Market is heating with compressed offers. Differentiate on value, not price. Avoid direct competition.";
    case "HEATING":
      return "Growing competition. Establish authority early with unique angles.";
    case "COOLING":
      return "Low activity market. Opportunity for first-mover advantage with consistent presence.";
    case "SATURATED":
      return "Content saturation detected. Focus on underserved formats and angles.";
    case "COMPRESSING":
      return "Price pressure increasing. Emphasize value proposition over discounts.";
    default:
      return "Moderate market activity. Build consistent presence with differentiated positioning.";
  }
}

export function buildDefensiveRisks(confidence: any, trajectory: any, intents: any[]): string[] {
  const risks: string[] = [];

  if (confidence.guardDecision === "BLOCK") {
    risks.push("INSUFFICIENT DATA: Cannot assess defensive risks reliably");
    return risks;
  }

  const aggressiveCompetitors = intents.filter((i: any) =>
    i.intentCategory === "AGGRESSIVE_SCALING" || i.intentCategory === "PRICE_WAR"
  );
  if (aggressiveCompetitors.length > 0) {
    risks.push(`${aggressiveCompetitors.length} competitor(s) showing aggressive/price-war behavior`);
  }

  if (trajectory.offerCompressionIndex > 0.5) {
    risks.push("Offer compression detected: market trending toward price competition");
  }

  if (trajectory.narrativeConvergenceScore > 0.7) {
    risks.push("High narrative convergence: competitors using similar messaging, differentiation needed");
  }

  if (trajectory.angleSaturationLevel > 0.6) {
    risks.push("Content angle saturation: fresh angles needed to stand out");
  }

  return risks;
}

export class MarketIntelligenceV3 {
  static async run(
    mode: MIv3Mode,
    accountId: string,
    campaignId: string,
    forceRefresh: boolean = false,
  ): Promise<MIv3DiagnosticResult> {
    const lockKey = `${accountId}:${campaignId}`;

    const existingLock = activeLocks.get(lockKey);
    if (existingLock) {
      console.log(`[MIv3] Concurrent run detected for ${lockKey}, waiting for existing run`);
      return existingLock;
    }

    const runPromise = this._executeRun(mode, accountId, campaignId, forceRefresh);
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
  ): Promise<MIv3DiagnosticResult> {
    console.log(`[MIv3] MARKET_OVERVIEW_DIAGNOSTIC_RUN | mode=${mode} | accountId=${accountId} | campaignId=${campaignId}`);

    logAudit("MARKET_OVERVIEW_DIAGNOSTIC_RUN", {
      mode,
      accountId,
      campaignId,
      caller: ISOLATION_ALLOWED_CALLER,
    }).catch(() => {});

    const competitors = await getCompetitorData(accountId);
    const competitorHash = computeCompetitorHash(competitors);

    if (!forceRefresh) {
      const cached = await getCachedSnapshot(accountId, campaignId, competitorHash);
      if (cached) {
        console.log(`[MIv3] Returning cached snapshot ${cached.id}`);
        return buildResultFromSnapshot(cached);
      }
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
    const dataFreshnessDays = computeDataFreshnessDays(competitors);
    const intents = classifyAllIntents(signalResults);
    const dominantIntent = computeDominantMarketIntent(intents);
    const trajectory = computeTrajectory(signalResults, intents);
    const confidence = computeConfidence(signalResults, dataFreshnessDays);
    const dominanceResults = computeAllDominance(signalResults, confidence);
    const missingFlags = aggregateMissingFlags(signalResults);
    const volatilityIndex = computeVolatilityIndex(signalResults);
    const trajectoryDirection = deriveTrajectoryDirection(trajectory);
    const marketState = deriveMarketState(trajectory, confidence.level);
    const entryStrategy = buildEntryStrategy(confidence, trajectory, dominantIntent);
    const defensiveRisks = buildDefensiveRisks(confidence, trajectory, intents);

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
        narrativeSynthesis = buildDeterministicNarrative(marketState, trajectoryDirection, dominantIntent, confidence, intents);
        telemetry.actualTokensUsed = 0;
      } catch (err) {
        console.error(`[MIv3] Narrative synthesis failed, returning deterministic only:`, err);
        narrativeSynthesis = null;
      }
    }

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
      telemetry: JSON.stringify(telemetry),
      narrativeSynthesis,
      entryStrategy,
      defensiveRisks: JSON.stringify(defensiveRisks),
      missingSignalFlags: JSON.stringify(missingFlags),
      volatilityIndex,
      dataFreshnessDays,
      overallConfidence: confidence.overall,
      confidenceLevel: confidence.level,
      analysisVersion: ENGINE_VERSION,
      status: "COMPLETE" as const,
      confirmedRuns,
      previousDirection: trajectoryDirection,
      directionLockedUntil: directionLockedUntil ? new Date(directionLockedUntil) : null,
    };

    const completionCheck = validateSnapshotCompleteness(snapshotPayload);
    if (!completionCheck.valid) {
      console.log(`[MIv3] SNAPSHOT_COMPLETION_CONTRACT_VIOLATED | failures=${completionCheck.failures.join(", ")}`);
      snapshotPayload.status = "PARTIAL" as any;
    }

    const [snapshot] = await db.insert(miSnapshots).values(snapshotPayload).returning();

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
      entryStrategy,
      defensiveRisks,
      confidence,
      missingSignalFlags: missingFlags,
      dataFreshnessDays,
      volatilityIndex,
    };

    const guard = await import("./confidence-engine").then(m => m.evaluateSignalStabilityGuard(signalResults));

    return {
      output,
      snapshotId: snapshot.id,
      executionMode,
      telemetry,
      dominanceData: dominanceResults,
      trajectoryData: trajectory,
      signalGuard: guard,
      twoRunStatus,
      cached: false,
      timestamp: new Date().toISOString(),
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
  const defensiveRisks = parseJsonSafe(snapshot.defensiveRisks, []);
  const missingFlags = parseJsonSafe(snapshot.missingSignalFlags, []);

  const output: MIv3Output = {
    marketState: snapshot.marketState || "INSUFFICIENT_DATA",
    dominantIntentType: intentData[0]?.intentCategory || "STABLE_DOMINANT",
    competitorIntentMap: intentData,
    trajectoryDirection: snapshot.previousDirection || "STABLE",
    narrativeSaturationLevel: trajectoryData.angleSaturationLevel || 0,
    revivalPotential: trajectoryData.revivalPotential || 0,
    entryStrategy: snapshot.entryStrategy || null,
    defensiveRisks,
    confidence: confidenceData,
    missingSignalFlags: missingFlags,
    dataFreshnessDays: snapshot.dataFreshnessDays || 0,
    volatilityIndex: snapshot.volatilityIndex || 0,
  };

  return {
    output,
    snapshotId: snapshot.id,
    executionMode: snapshot.executionMode as ExecutionMode,
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
    cached: true,
    timestamp: snapshot.createdAt?.toISOString?.() || new Date().toISOString(),
  };
}

export function buildDeterministicNarrative(
  marketState: string,
  direction: string,
  dominantIntent: string,
  confidence: any,
  intents: any[],
): string {
  const parts: string[] = [];

  parts.push(`Market State: ${marketState}.`);
  parts.push(`Trajectory: ${direction}.`);
  parts.push(`Dominant competitor intent: ${dominantIntent}.`);
  parts.push(`Confidence: ${confidence.level} (${(confidence.overall * 100).toFixed(1)}%).`);

  if (confidence.guardDecision === "DOWNGRADE") {
    parts.push("EXPLORATORY MODE: Data insufficient for strong conclusions. Recommendations are hypotheses only.");
  }

  const intentSummary = intents.map((i: any) => `${i.competitorName}: ${i.intentCategory}`).join(", ");
  if (intentSummary) parts.push(`Intent breakdown: ${intentSummary}.`);

  return parts.join(" ");
}

export { validateEngineIsolation, validateDomainOwnership, rejectBlockedEngine, assertSnapshotReadOnly, assertNoPlanWrites, assertNoOrchestrator, assertNoAutopilot, assertNoComputeFromExternal, getProtectedDomains, getBlockedEngines } from "./isolation-guard";
