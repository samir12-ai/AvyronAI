import { createHash } from "crypto";
import { db } from "../db";
import { growthCampaigns, campaignOfferings, businessUnderstandingSnapshots } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { loadCanonicalCustomerVoice, type CustomerEvidenceUnit } from "../competitive-intelligence/evidence-routing";
import {
  judgePrimaryMarketVoiceSufficiencyWithLLM,
  deduplicatePrimaryUnits,
  extractEvidenceSourceEntity,
  type MarketVoiceSufficiencyResult,
  type SufficiencyJudgeContext,
} from "../audience-engine/semantic-sufficiency-judge";

export interface PinnedCorpusAssessment {
  fingerprint: string;
  judgedAt: string;
  evaluationCount: number;
  totalEligibleUnits: number;
  dedupedUnitsCount: number;
  uniqueEntitiesCount: number;
  dominantEntityShare: number;
  isSufficient: boolean;
  verdict: "SUFFICIENT" | "INSUFFICIENT";
  reason: string;
  categoryRelevance: string;
  buyerAuthenticity: string;
  sourceConcentrationRisk: string;
  categoryBreadth: string;
  substantiveThemesFound: string[];
}

export interface CombinedReadinessEvaluation {
  isSufficient: boolean;
  verdict: "SUFFICIENT" | "INSUFFICIENT";
  reason: string;
  fingerprint: string;
  isReusedFromPinned: boolean;
  assessment: PinnedCorpusAssessment;
  units: CustomerEvidenceUnit[];
  rawCount: number;
  primaryMarketVoiceCount: number;
  supportingSocialVoiceCount: number;
  benchmarkContextCount: number;
}

// Module-level persistent cache keyed by `${campaignId}:${fingerprint}`
const pinnedAssessments = new Map<string, PinnedCorpusAssessment>();

/**
 * Computes deterministic SHA-256 fingerprint for a deduplicated customer evidence corpus.
 */
export function computeCorpusFingerprint(units: CustomerEvidenceUnit[]): string {
  if (!units || units.length === 0) return "empty_corpus";

  const sorted = [...units].sort((a, b) => a.evidenceId.localeCompare(b.evidenceId));
  const payload = sorted.map((u) => {
    const { sourceEntity, hostingPlatform } = extractEvidenceSourceEntity(u);
    return {
      id: u.evidenceId,
      text: u.text.trim().toLowerCase(),
      origin: u.origin,
      platform: u.platform,
      entity: sourceEntity,
      hosting: hostingPlatform,
      pool: u.evidencePool,
    };
  });

  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/**
 * Resolves canonical offering and business context for the sufficiency judge.
 */
async function resolveJudgeContext(
  accountId: string,
  campaignId: string,
  campaignOfferingId?: string
): Promise<SufficiencyJudgeContext> {
  let heroProduct = "Core Offering";
  let category = "General Commerce";
  let businessName = "Business";
  let market = "Target Market";

  const [campaign] = await db
    .select()
    .from(growthCampaigns)
    .where(eq(growthCampaigns.id, campaignId))
    .limit(1);

  if (campaign) {
    businessName = campaign.name || businessName;
    const anchor = campaign.productAnchor as any;
    if (anchor?.name) heroProduct = anchor.name;
    if (anchor?.type) category = anchor.type;
    if (anchor?.targetGeography) market = anchor.targetGeography;
  }

  if (campaignOfferingId) {
    const [offering] = await db
      .select()
      .from(campaignOfferings)
      .where(and(eq(campaignOfferings.id, campaignOfferingId), eq(campaignOfferings.campaignId, campaignId)))
      .limit(1);
    if (offering?.offeringName) {
      heroProduct = offering.offeringName;
    }
  }

  const [buSnapshot] = await db
    .select()
    .from(businessUnderstandingSnapshots)
    .where(and(eq(businessUnderstandingSnapshots.campaignId, campaignId), eq(businessUnderstandingSnapshots.status, "COMPLETE")))
    .orderBy(desc(businessUnderstandingSnapshots.createdAt))
    .limit(1);

  if (buSnapshot) {
    const bu = ((buSnapshot as any).businessUnderstandingSnapshot || buSnapshot.businessUnderstanding || (buSnapshot as any).snapshotData) as any;
    if (bu?.businessName) businessName = bu.businessName;
    if (bu?.offeringUnderstanding?.category || bu?.generalIndustry) {
      category = bu?.offeringUnderstanding?.category || bu?.generalIndustry;
    }
    if (bu?.targetUnderstanding?.targetRoles?.[0]?.roleTitle) {
      market = bu.targetUnderstanding.targetRoles[0].roleTitle;
    }
  }

  return { heroProduct, businessName, category, market };
}

/**
 * Evaluates the combined eligible customer evidence corpus from competitor comments,
 * competitor reviews, and Market Voice quotes.
 */
export async function evaluateCombinedEvidenceReadiness(opts: {
  accountId: string;
  campaignId: string;
  campaignOfferingId?: string;
  approvedMarketVoiceEvidenceIds?: string[];
  forceRefresh?: boolean;
  evidenceManifest?: import("@shared/schema").EvidenceManifest | null;
}): Promise<CombinedReadinessEvaluation> {
  const { accountId, campaignId, campaignOfferingId, approvedMarketVoiceEvidenceIds, forceRefresh, evidenceManifest } = opts;

  // 1. Ingest unified Canonical Customer Voice universe
  const rawUnits = await loadCanonicalCustomerVoice(accountId, campaignId, {
    approvedMarketVoiceEvidenceIds,
    evidenceManifest,
  });

  const primaryMarketVoiceUnits = rawUnits.filter((u) => u.evidencePool === "PRIMARY_MARKET_VOICE");
  const supportingSocialVoiceUnits = rawUnits.filter((u) => u.evidencePool === "SUPPORTING_SOCIAL_CUSTOMER_VOICE");
  const benchmarkContextUnits = rawUnits.filter((u) => u.evidencePool === "BENCHMARK_CONTEXT");

  // Eligible customer voice pool: primary market voice + supporting social customer voice
  // Excludes UNRESOLVED_EXCLUDED
  const eligibleUnits = rawUnits.filter(
    (u) => u.evidencePool === "PRIMARY_MARKET_VOICE" || u.evidencePool === "SUPPORTING_SOCIAL_CUSTOMER_VOICE"
  );

  // 2. Deduplicate across platform mirrors
  const dedupedUnits = deduplicatePrimaryUnits(eligibleUnits);
  const fingerprint = computeCorpusFingerprint(dedupedUnits);
  const cacheKey = `${campaignId}:${fingerprint}`;

  // 3. Check for pinned judgment
  if (!forceRefresh && pinnedAssessments.has(cacheKey)) {
    const pinned = pinnedAssessments.get(cacheKey)!;
    console.log(
      `[CombinedReadiness] PINNED_ASSESSMENT_REUSED | campaign=${campaignId} fingerprint=${fingerprint.slice(0, 12)} verdict=${pinned.verdict} isSufficient=${pinned.isSufficient}`
    );
    return {
      isSufficient: pinned.isSufficient,
      verdict: pinned.verdict,
      reason: pinned.reason,
      fingerprint,
      isReusedFromPinned: true,
      assessment: pinned,
      units: dedupedUnits,
      rawCount: rawUnits.length,
      primaryMarketVoiceCount: primaryMarketVoiceUnits.length,
      supportingSocialVoiceCount: supportingSocialVoiceUnits.length,
      benchmarkContextCount: benchmarkContextUnits.length,
    };
  }

  // 4. Compute diagnostic telemetry
  const entityCounts: Record<string, number> = {};
  for (const u of dedupedUnits) {
    const { sourceEntity } = extractEvidenceSourceEntity(u);
    entityCounts[sourceEntity] = (entityCounts[sourceEntity] || 0) + 1;
  }
  const uniqueEntities = Object.keys(entityCounts);
  const maxEntityCount = Math.max(...Object.values(entityCounts), 0);
  const dominantEntityShare = dedupedUnits.length > 0 ? Number((maxEntityCount / dedupedUnits.length).toFixed(2)) : 0;

  // 5. Evaluate semantic sufficiency using Hostile Semantic Judge
  const context = await resolveJudgeContext(accountId, campaignId, campaignOfferingId);

  console.log(
    `[CombinedReadiness] EVALUATING_COMBINED_CORPUS | campaign=${campaignId} eligibleUnits=${eligibleUnits.length} deduped=${dedupedUnits.length} entities=${uniqueEntities.length} fingerprint=${fingerprint.slice(0, 12)}`
  );

  const sufficiencyResult: MarketVoiceSufficiencyResult = await judgePrimaryMarketVoiceSufficiencyWithLLM(
    dedupedUnits,
    context,
    accountId
  );

  const assessment: PinnedCorpusAssessment = {
    fingerprint,
    judgedAt: new Date().toISOString(),
    evaluationCount: (pinnedAssessments.get(cacheKey)?.evaluationCount || 0) + 1,
    totalEligibleUnits: eligibleUnits.length,
    dedupedUnitsCount: dedupedUnits.length,
    uniqueEntitiesCount: uniqueEntities.length,
    dominantEntityShare,
    isSufficient: sufficiencyResult.isSufficient,
    verdict: sufficiencyResult.verdict,
    reason: sufficiencyResult.reason,
    categoryRelevance: sufficiencyResult.categoryRelevance,
    buyerAuthenticity: sufficiencyResult.buyerAuthenticity,
    sourceConcentrationRisk: sufficiencyResult.sourceConcentrationRisk,
    categoryBreadth: sufficiencyResult.categoryBreadth,
    substantiveThemesFound: sufficiencyResult.substantiveThemesFound,
  };

  pinnedAssessments.set(cacheKey, assessment);

  console.log(
    `[CombinedReadiness] ASSESSMENT_PINNED | campaign=${campaignId} fingerprint=${fingerprint.slice(0, 12)} verdict=${assessment.verdict} isSufficient=${assessment.isSufficient}`
  );

  return {
    isSufficient: assessment.isSufficient,
    verdict: assessment.verdict,
    reason: assessment.reason,
    fingerprint,
    isReusedFromPinned: false,
    assessment,
    units: dedupedUnits,
    rawCount: rawUnits.length,
    primaryMarketVoiceCount: primaryMarketVoiceUnits.length,
    supportingSocialVoiceCount: supportingSocialVoiceUnits.length,
    benchmarkContextCount: benchmarkContextUnits.length,
  };
}

export function clearPinnedAssessment(campaignId: string): void {
  for (const key of pinnedAssessments.keys()) {
    if (key.startsWith(`${campaignId}:`)) {
      pinnedAssessments.delete(key);
    }
  }
}
