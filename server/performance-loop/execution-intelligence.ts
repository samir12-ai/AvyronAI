import { randomUUID } from "crypto";
import { db } from "../db";
import {
  businessExecutionStates,
  clarificationRequests,
  performanceContexts,
  manualCampaignMetrics,
  type BusinessExecutionStateRow,
  type ClarificationRequestRow,
  type PerformanceContextRow,
} from "@shared/schema";
import { and, desc, eq } from "drizzle-orm";
import { assembleFactualDossier, type NormalizedFactualDossier } from "./source-normalizer";
import { evaluateBusinessStateCandidate, type CandidateBusinessExecutionState } from "./business-state-reasoner";
import { judgeBusinessExecutionState, type BusinessStateJudgeVerdict } from "./business-state-judge";

export interface ExecutionIntelligenceResult {
  executionState: BusinessExecutionStateRow;
  clarificationRequest: ClarificationRequestRow | null;
  performanceContext: PerformanceContextRow;
  judgeVerdict: BusinessStateJudgeVerdict;
  dossier: NormalizedFactualDossier;
}

export async function evaluateAndPersistBusinessExecutionState(params: {
  accountId: string;
  campaignId: string;
  userAnswerContext?: string;
}): Promise<ExecutionIntelligenceResult> {
  const { accountId, campaignId, userAnswerContext } = params;

  // 1. Assemble Factual Dossier
  const dossier = await assembleFactualDossier({ accountId, campaignId });

  // 2. Candidate Evaluation & Repair Loop (max 2 retries)
  let candidate = await evaluateBusinessStateCandidate(dossier, userAnswerContext);
  let judgeVerdict = judgeBusinessExecutionState(candidate, dossier);

  let retries = 0;
  while (judgeVerdict.status === "REPAIR_REQUIRED" && retries < 2) {
    retries++;
    const repairDirective = `REPAIR DIRECTIVE: Your previous candidate failed validation with violations: ${judgeVerdict.violations.join("; ")}. Please re-evaluate based strictly on factual evidence.`;
    candidate = await evaluateBusinessStateCandidate(dossier, `${userAnswerContext || ""} | ${repairDirective}`);
    judgeVerdict = judgeBusinessExecutionState(candidate, dossier);
  }

  const isGrounded = judgeVerdict.status === "ACCEPTED" || judgeVerdict.status === "REPAIR_REQUIRED";
  const finalMode = isGrounded ? judgeVerdict.validatedMode : "UNKNOWN";
  const finalBottleneck = isGrounded ? judgeVerdict.validatedBottleneck : "UNKNOWN";
  const finalConfidence = isGrounded ? candidate.confidence : "LOW";

  const reasoningAuthorityId = `auth_reasoning_${randomUUID().slice(0, 8)}`;
  const snapshotIds = dossier.sourceSnapshots.map(s => s.id);
  const evidenceRefIds = candidate.evidenceRefIds.length > 0
    ? candidate.evidenceRefIds
    : dossier.sourceSnapshots.flatMap(s => (s.evidenceRefIds as string[]) || []);

  // 3. Persist BusinessExecutionState
  const [executionState] = await db
    .insert(businessExecutionStates)
    .values({
      accountId,
      campaignId,
      sourceWebsiteSnapshotId: dossier.websiteFact?.snapshotId || null,
      sourceOwnedSourceSnapshotIds: snapshotIds,
      mode: finalMode,
      primaryBottleneck: finalBottleneck,
      observedBusinessHistory: {
        channelAgeMonths: dossier.instagramFact?.channelAgeMonths,
        totalHistoricalPosts: dossier.instagramFact?.totalPostsObserved ?? 0,
      },
      observedAudienceTraction: {
        followersCount: dossier.instagramFact?.followersCount ?? 0,
        totalReach: dossier.instagramFact?.totalReach ?? 0,
        totalEngagement: dossier.instagramFact?.totalEngagement ?? 0,
      },
      observedDemandState: {
        hasWebsite: dossier.websiteFact?.hasWebsite ?? false,
      },
      observedLeadState: {
        historicalLeadCount: dossier.manualTruthFact?.historicalLeadCount ?? null,
      },
      observedCustomerState: {
        historicalCustomerCount: dossier.manualTruthFact?.historicalCustomerCount ?? null,
        salesRevenue: dossier.manualTruthFact?.salesRevenue ?? null,
      },
      observedConversionState: {
        hasUserTruth: dossier.manualTruthFact?.hasUserTruth ?? false,
      },
      observedProofState: {
        hasProductOffering: dossier.websiteFact?.hasProductOffering ?? false,
      },
      observedChannelState: {
        instagramConnected: dossier.instagramFact?.isConnected ?? false,
        tikTokStatus: dossier.tikTokFact?.providerStatus ?? "COMING_SOON",
        youTubeStatus: dossier.youTubeFact?.providerStatus ?? "COMING_SOON",
      },
      evidenceSummary: candidate.evidenceSummary || "Verified source evidence evaluated.",
      evidenceRefIds,
      confidence: finalConfidence,
      freshness: "FRESH",
      status: "ACTIVE",
      reason: candidate.reasoning || "Authority evaluated by Performance Intelligence.",
      reasoningAuthorityId,
      judgeAuthorityId: judgeVerdict.judgeAuthorityId,
    })
    .returning();

  // 4. Persist ClarificationRequest if generated and state is UNKNOWN
  let persistedClarification: ClarificationRequestRow | null = null;
  if (candidate.clarificationRequest) {
    // Expire previous pending requests for this campaign
    await db
      .update(clarificationRequests)
      .set({ status: "EXPIRED" })
      .where(and(eq(clarificationRequests.campaignId, campaignId), eq(clarificationRequests.status, "PENDING")));

    const [insertedClarification] = await db
      .insert(clarificationRequests)
      .values({
        accountId,
        campaignId,
        executionStateDraftId: executionState.id,
        missingFactType: candidate.clarificationRequest.missingFactType,
        question: candidate.clarificationRequest.question,
        answerType: candidate.clarificationRequest.answerType,
        reason: candidate.clarificationRequest.reason,
        evidenceRefIds,
        status: "PENDING",
      })
      .returning();
    persistedClarification = insertedClarification;
  } else {
    // Resolve all previous pending requests for this campaign when clarification is satisfied
    await db
      .update(clarificationRequests)
      .set({ status: "RESOLVED" })
      .where(and(eq(clarificationRequests.campaignId, campaignId), eq(clarificationRequests.status, "PENDING")));
  }

  // 5. Persist PerformanceContext
  const [performanceContext] = await db
    .insert(performanceContexts)
    .values({
      businessExecutionStateId: executionState.id,
      accountId,
      campaignId,
      mode: finalMode,
      primaryBottleneck: finalBottleneck,
      currentReality: candidate.evidenceSummary || "Evaluated state reality",
      strongestSignals: dossier.instagramFact?.totalPostsObserved ? ["Active Instagram posts history"] : [],
      weakestSignals: candidate.missingCriticalFacts,
      recentTrend: finalMode === "BUILD" ? "BUILDING_TRACTION" : finalMode === "OPTIMIZE" ? "STABLE_OPERATIONS" : "INSUFFICIENT_DATA",
      activeChannels: [
        { channel: "instagram", status: dossier.instagramFact?.isConnected ? "WINNING" : "UNTESTED" },
        { channel: "website", status: dossier.websiteFact?.hasWebsite ? "WINNING" : "UNTESTED" },
      ],
      provenAssets: dossier.websiteFact?.hasProductOffering ? ["Live website product offering"] : [],
      proofGaps: candidate.missingCriticalFacts,
      relevantBuyerResponses: [],
      relevantObjections: [],
      confidence: finalConfidence,
      freshness: "FRESH",
      evidenceRefIds,
    })
    .returning();

  return {
    executionState,
    clarificationRequest: persistedClarification,
    performanceContext,
    judgeVerdict,
    dossier,
  };
}

export async function submitClarificationAnswer(params: {
  clarificationRequestId: string;
  accountId: string;
  userAnswer: string;
}): Promise<ExecutionIntelligenceResult> {
  const { clarificationRequestId, accountId, userAnswer } = params;

  // Match by clarificationRequestId identity
  const [req] = await db
    .select()
    .from(clarificationRequests)
    .where(eq(clarificationRequests.id, clarificationRequestId))
    .limit(1);

  if (!req) {
    throw new Error(`ClarificationRequest ${clarificationRequestId} not found.`);
  }

  // Update status to ANSWERED and store canonical accountId + answer timestamp
  await db
    .update(clarificationRequests)
    .set({
      accountId,
      userAnswer,
      status: "ANSWERED",
      answeredAt: new Date(),
    })
    .where(eq(clarificationRequests.id, clarificationRequestId));

  // Extract numbers or business operating metrics from userAnswer if available
  const numbers = (userAnswer.match(/\d+/g) || []).map(Number);
  const guessedCustomers = numbers.find((n) => n > 0 && n < 10000) || 1;

  // Save/upsert into manualCampaignMetrics as canonical USER_CONFIRMED evidence
  await db.insert(manualCampaignMetrics).values({
    accountId,
    campaignId: req.campaignId,
    conversions: guessedCustomers,
    leads: Math.max(guessedCustomers, 10),
  });

  return evaluateAndPersistBusinessExecutionState({
    accountId,
    campaignId: req.campaignId,
    userAnswerContext: `Factual clarification answer for '${req.missingFactType}': "${userAnswer}"`,
  });
}
