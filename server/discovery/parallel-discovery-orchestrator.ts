import { db } from "../db";
import { and, desc, eq } from "drizzle-orm";
import { campaignOfferings } from "@shared/schema";
import { resolveCurrentBusinessUnderstandingOrThrow } from "../business-understanding/resolver";
import { runCompetitorDiscoveryEngine } from "./competitor-discovery-engine";
import { loadMarketVoicePlannerContext, planMarketVoiceSearchIntents } from "../market-voice/search-planner";
import { executeMarketVoiceDiscoveryJob } from "../market-voice/discovery-engine";
import {
  type ParallelDiscoveryResult,
  type CompetitorDiscoveryReport,
} from "@shared/contracts/discovery-contracts";

export interface ParallelDiscoveryOptions {
  accountId: string;
  campaignId: string;
  timeoutMs?: number;
  skipMarketVoice?: boolean;
}

/**
 * Top-level Parallel Discovery Orchestrator.
 * 
 * Invariants:
 * 1. Resolves canonical context via resolveCurrentBusinessUnderstandingOrThrow.
 * 2. Launches Market Voice Discovery and Competitor Discovery as bounded parallel lanes.
 * 3. Enforces single canonical competitor onboarding (onboardCompetitorWithMultiSourceDiscovery).
 * 4. NEVER creates market_voice_evidence (Phase 4).
 * 5. NEVER creates audience, strategy roots, or strategic plans.
 */
export async function runParallelDiscovery(
  options: ParallelDiscoveryOptions
): Promise<ParallelDiscoveryResult> {
  const startedAt = Date.now();
  const { accountId, campaignId, timeoutMs = 120000, skipMarketVoice = false } = options;

  // 1. Resolve canonical Offering and Business Understanding context strictly
  const [offering] = await db
    .select()
    .from(campaignOfferings)
    .where(and(
      eq(campaignOfferings.accountId, accountId),
      eq(campaignOfferings.campaignId, campaignId)
    ))
    .orderBy(desc(campaignOfferings.createdAt))
    .limit(1);

  if (!offering) {
    throw new Error(`[ParallelDiscovery] No canonical offering found for campaignId=${campaignId}`);
  }

  // Enforce canonical BU resolution (throws if missing or incomplete)
  await resolveCurrentBusinessUnderstandingOrThrow({
    accountId,
    campaignId,
    campaignOfferingId: offering.id,
  });

  let competitorReport: CompetitorDiscoveryReport;
  let marketVoiceSummary: { discoveryJobId?: string; status: string; totalIntents: number; totalResultsPersisted: number } | undefined = undefined;

  // 2. Execute Competitor Discovery & Market Voice in Bounded Parallelism
  const [compResult, mvResult] = await Promise.allSettled([
    // Mission A: Competitor Discovery Engine (read/verify only)
    runCompetitorDiscoveryEngine({
      accountId,
      campaignId,
      timeoutMs: timeoutMs - 5000,
      autoOnboardApproved: false,
    }),

    // Mission B: Market Voice Discovery (Phase 2 & Phase 3)
    skipMarketVoice
      ? Promise.resolve(null)
      : (async () => {
          try {
            const mvContext = await loadMarketVoicePlannerContext({
              campaignId,
              campaignOfferingId: offering.id,
              accountId,
            });
            const planned = await planMarketVoiceSearchIntents(mvContext);
            if (planned.success && planned.job?.id) {
              const execSummary = await executeMarketVoiceDiscoveryJob(planned.job.id);
              return {
                discoveryJobId: planned.job.id,
                status: execSummary.status,
                totalIntents: execSummary.totalIntents,
                totalResultsPersisted: execSummary.totalResultsPersisted,
              };
            }
          } catch (mvErr: any) {
            console.warn("[ParallelDiscovery] Market Voice discovery warning:", mvErr.message);
          }
          return null;
        })(),
  ]);

  if (compResult.status === "fulfilled") {
    competitorReport = compResult.value;
  } else {
    console.error("[ParallelDiscovery] Competitor discovery failed:", compResult.reason);
    competitorReport = {
      status: "SEARCH_PROVIDER_UNAVAILABLE",
      searchMissions: [],
      totalOccurrencesDiscovered: 0,
      uniqueCandidateCount: 0,
      approvedCandidates: [],
      rejectedCandidates: [],
      insufficientEvidenceCandidates: [],
      candidates: [],
      onboardedCompetitors: [],
      message: compResult.reason?.message || "Competitor discovery failed unexpectedly",
      telemetry: {
        missionsPlanned: 0,
        missionsExecuted: 0,
        providerCallsMade: 0,
        llmCallsMade: 0,
        totalRuntimeMs: Date.now() - startedAt,
      },
    };
  }

  if (mvResult.status === "fulfilled" && mvResult.value) {
    marketVoiceSummary = mvResult.value;
  }

  const globalStatus = (competitorReport.approvedCandidates.length > 0)
    ? (competitorReport.status === "DISCOVERY_COMPLETE" ? "COMPLETED" : "COMPLETED_WITH_GAPS")
    : "FAILED";

  return {
    accountId,
    campaignId,
    campaignOfferingId: offering.id,
    competitorDiscovery: competitorReport,
    marketVoice: marketVoiceSummary,
    globalStatus,
    totalRuntimeMs: Date.now() - startedAt,
  };
}
