import { randomUUID } from "crypto";
import { db } from "../db";
import {
  businessExecutionStates,
  clarificationRequests,
  performanceContexts,
  manualCampaignMetrics,
  notifications,
  type BusinessExecutionStateRow,
  type ClarificationRequestRow,
  type PerformanceContextRow,
} from "@shared/schema";
import { and, desc, eq, like, or } from "drizzle-orm";
import { assembleFactualDossier, type NormalizedFactualDossier } from "./source-normalizer";
import { evaluateBusinessStateCandidate, type CandidateBusinessExecutionState } from "./business-state-reasoner";
import { judgeBusinessExecutionState, type BusinessStateJudgeVerdict } from "./business-state-judge";
import { syncCampaignAdaptiveReasoning } from "../adaptive/case-coordinator";
import { resolveEffectiveNow } from "./clock";
import { runWithAiCampaignContext } from "../ai-client";

export class BaselineValidationError extends Error {
  status: number;
  code: string;
  constructor(message: string, code: string = "INVALID_BASELINE_ANSWER", status: number = 400) {
    super(message);
    this.name = "BaselineValidationError";
    this.code = code;
    this.status = status;
  }
}

export interface ExecutionIntelligenceResult {
  executionState: BusinessExecutionStateRow;
  clarificationRequest: ClarificationRequestRow | null;
  performanceContext: PerformanceContextRow;
  judgeVerdict: BusinessStateJudgeVerdict;
  dossier: NormalizedFactualDossier;
  reasoningSync?: {
    casesCreated: number;
    decisionsCreated: number;
    casesSkippedIdempotent: number;
  } | null;
}

export interface SubmitClarificationResult extends ExecutionIntelligenceResult {
  saved: boolean;
  clarificationRequestId: string;
  answeredAt: string;
  answeredClarification: ClarificationRequestRow;
  evaluationStatus: "COMPLETED" | "DEFERRED_ERROR";
  evaluationError: string | null;
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
  let candidate = await runWithAiCampaignContext(
    { accountId, campaignId, operationType: "performance_evaluation" },
    () => evaluateBusinessStateCandidate(dossier, userAnswerContext)
  );
  let judgeVerdict = judgeBusinessExecutionState(candidate, dossier);

  let retries = 0;
  while (judgeVerdict.status === "REPAIR_REQUIRED" && retries < 2) {
    retries++;
    const repairDirective = `REPAIR DIRECTIVE: Your previous candidate failed validation with violations: ${judgeVerdict.violations.join("; ")}. Please re-evaluate based strictly on factual evidence.`;
    candidate = await runWithAiCampaignContext(
      { accountId, campaignId, operationType: "performance_evaluation_repair" },
      () => evaluateBusinessStateCandidate(dossier, `${userAnswerContext || ""} | ${repairDirective}`)
    );
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

  const totalSocialPosts =
    (dossier.instagramFact?.totalPostsObserved ?? 0) +
    (dossier.youTubeFact?.totalPostsObserved ?? 0) +
    (dossier.tikTokFact?.totalPostsObserved ?? 0) +
    (dossier.linkedInFact?.totalPostsObserved ?? 0);

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
        operatingHistoryMonths: dossier.manualTruthFact?.operatingHistoryMonths ?? null,
        hasHistoricalPaidCustomers: dossier.manualTruthFact?.hasHistoricalPaidCustomers ?? null,
        historicalCustomerCount: dossier.manualTruthFact?.historicalCustomerCount ?? null,
        historicalLeadCount: dossier.manualTruthFact?.historicalLeadCount ?? null,
        totalHistoricalPosts: totalSocialPosts,
        instagramPostsObserved: dossier.instagramFact?.totalPostsObserved ?? 0,
        youTubePostsObserved: dossier.youTubeFact?.totalPostsObserved ?? 0,
        tikTokPostsObserved: dossier.tikTokFact?.totalPostsObserved ?? 0,
        linkedInPostsObserved: dossier.linkedInFact?.totalPostsObserved ?? 0,
      },
      observedAudienceTraction: {
        followersCount:
          (dossier.instagramFact?.followersCount ?? 0) +
          (dossier.youTubeFact?.followersCount ?? 0) +
          (dossier.tikTokFact?.followersCount ?? 0) +
          (dossier.linkedInFact?.followersCount ?? 0),
        instagramFollowersCount: dossier.instagramFact?.followersCount ?? 0,
        youTubeFollowersCount: dossier.youTubeFact?.followersCount ?? 0,
        tikTokFollowersCount: dossier.tikTokFact?.followersCount ?? 0,
        linkedInFollowersCount: dossier.linkedInFact?.followersCount ?? 0,
        totalReach: dossier.instagramFact?.totalReach ?? null,
        totalViews:
          (dossier.youTubeFact?.totalViews ?? 0) +
          (dossier.tikTokFact?.totalViews ?? 0) +
          (dossier.linkedInFact?.totalViews ?? 0),
        totalEngagement:
          (dossier.instagramFact?.totalEngagement ?? 0) +
          (dossier.youTubeFact?.totalEngagement ?? 0) +
          (dossier.tikTokFact?.totalEngagement ?? 0) +
          (dossier.linkedInFact?.totalEngagement ?? 0),
        sharedChannelAttribution: dossier.sharedChannelAttribution || null,
      },
      observedDemandState: {
        hasWebsite: dossier.websiteFact?.hasWebsite ?? false,
      },
      observedLeadState: {
        historicalLeadCount: dossier.manualTruthFact?.historicalLeadCount ?? null,
        weeklyWindowLeads: dossier.manualTruthFact?.weeklyLeads ?? null,
        weeklyQualifiedLeads: dossier.manualTruthFact?.weeklyWindow?.qualifiedLeads ?? null,
        weeklyConversations: dossier.manualTruthFact?.weeklyWindow?.conversations ?? null,
        weeklyWindowId: dossier.manualTruthFact?.weeklyWindow?.windowId ?? null,
        weeklyWindowCompletionState: dossier.manualTruthFact?.weeklyWindow?.completionState ?? null,
      },
      observedCustomerState: {
        historicalCustomerCount: dossier.manualTruthFact?.historicalCustomerCount ?? null,
        hasHistoricalPaidCustomers: dossier.manualTruthFact?.hasHistoricalPaidCustomers ?? null,
        weeklyWindowPayingCustomers: dossier.manualTruthFact?.weeklyPayingCustomers ?? null,
        weeklyWindowRevenue: dossier.manualTruthFact?.weeklyRevenue ?? null,
        weeklyWindowAdSpend: dossier.manualTruthFact?.weeklyAdSpend ?? null,
        salesRevenue: dossier.manualTruthFact?.salesRevenue ?? null,
      },
      observedConversionState: {
        hasUserTruth: dossier.manualTruthFact?.hasUserTruth ?? false,
        hasBaselineTruth: dossier.manualTruthFact?.hasBaselineTruth ?? false,
        hasWeeklyWindowTruth: dossier.manualTruthFact?.hasWeeklyWindowTruth ?? false,
        weeklyWindowCompletionState: dossier.manualTruthFact?.weeklyWindow?.completionState ?? null,
      },
      observedProofState: {
        hasProductOffering: dossier.websiteFact?.hasProductOffering ?? false,
        offeringName: dossier.websiteFact?.offeringName ?? null,
      },
      observedChannelState: {
        instagramConnected: dossier.instagramFact?.isConnected ?? false,
        tikTokStatus: dossier.tikTokFact?.providerStatus ?? "NOT_CONNECTED",
        youTubeStatus: dossier.youTubeFact?.providerStatus ?? "NOT_CONNECTED",
        linkedInConnected: dossier.linkedInFact?.isConnected ?? false,
        linkedInStatus: dossier.linkedInFact?.providerStatus ?? "NOT_CONNECTED",
        linkedInLifecycleState: dossier.linkedInFact?.channelLifecycleState ?? "NOT_CONNECTED",
        linkedInError: dossier.linkedInFact?.scrapeError ?? null,
        sharedChannelAttribution: dossier.sharedChannelAttribution || null,
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

  // 4. Persist or reuse ClarificationRequest if baseline truth is still unanswered
  // INVARIANT: Reuse an existing PENDING request for the same missing fact and scope; do not expire/recreate on every evaluation.
  // Stop requesting baseline facts already answered.
  let persistedClarification: ClarificationRequestRow | null = null;
  const [alreadyAnsweredBaseline] = await db
    .select()
    .from(clarificationRequests)
    .where(
      and(
        eq(clarificationRequests.campaignId, campaignId),
        eq(clarificationRequests.status, "ANSWERED")
      )
    )
    .orderBy(desc(clarificationRequests.answeredAt))
    .limit(1);

  if (candidate.clarificationRequest && !alreadyAnsweredBaseline && !dossier.manualTruthFact?.hasBaselineTruth) {
    const [existingPending] = await db
      .select()
      .from(clarificationRequests)
      .where(
        and(
          eq(clarificationRequests.campaignId, campaignId),
          eq(clarificationRequests.status, "PENDING")
        )
      )
      .orderBy(desc(clarificationRequests.createdAt))
      .limit(1);

    const structuredQuestion =
      "Please confirm your business baseline: (1) How many months has your business been actively operating? (2) Has your business acquired paying customers prior to this campaign window (and if so, approximately how many)?";
    const structuredReason =
      "Separates operating duration from verified commercial traction so Avyron can calibrate BUILD vs. OPTIMIZE mode without conflating business age with sales.";

    if (existingPending) {
      const [updatedClarification] = await db
        .update(clarificationRequests)
        .set({
          accountId,
          executionStateDraftId: executionState.id,
          requestCategory: "BASELINE",
          missingFactType: "business_operating_baseline",
          question: structuredQuestion,
          answerType: "STRUCTURED_BASELINE",
          reason: structuredReason,
          evidenceRefIds,
          updatedAt: new Date(),
        })
        .where(eq(clarificationRequests.id, existingPending.id))
        .returning();
      persistedClarification = updatedClarification;
    } else {
      const [insertedClarification] = await db
        .insert(clarificationRequests)
        .values({
          accountId,
          campaignId,
          executionStateDraftId: executionState.id,
          requestCategory: "BASELINE",
          missingFactType: "business_operating_baseline",
          question: structuredQuestion,
          answerType: "STRUCTURED_BASELINE",
          reason: structuredReason,
          evidenceRefIds,
          status: "PENDING",
        })
        .returning();
      persistedClarification = insertedClarification;
    }
  } else if (alreadyAnsweredBaseline || dossier.manualTruthFact?.hasBaselineTruth) {
    // Resolve any remaining pending baseline requests once baseline truth is established
    await db
      .update(clarificationRequests)
      .set({ status: "RESOLVED", nextReminderAt: null, updatedAt: new Date() })
      .where(and(eq(clarificationRequests.campaignId, campaignId), eq(clarificationRequests.status, "PENDING")));
  }

  // 5. Persist PerformanceContext (Ensure missing commercial data does NOT block social/content execution analysis)
  const socialExecutionSummary =
    totalSocialPosts > 0
      ? `Observed ${totalSocialPosts} owned social posts across connected channels (${dossier.instagramFact?.totalPostsObserved ?? 0} Instagram, ${dossier.youTubeFact?.totalPostsObserved ?? 0} YouTube, ${dossier.tikTokFact?.totalPostsObserved ?? 0} TikTok, ${dossier.linkedInFact?.totalPostsObserved ?? 0} LinkedIn).`
      : null;
  const effectiveCurrentReality =
    finalMode === "UNKNOWN" && socialExecutionSummary
      ? `${socialExecutionSummary} Commercial baseline (historical sales/leads) is awaiting user confirmation.`
      : candidate.evidenceSummary || "Evaluated state reality";

  const [performanceContext] = await db
    .insert(performanceContexts)
    .values({
      businessExecutionStateId: executionState.id,
      accountId,
      campaignId,
      mode: finalMode,
      primaryBottleneck: finalBottleneck,
      currentReality: effectiveCurrentReality,
      strongestSignals: [
        ...(dossier.instagramFact?.totalPostsObserved ? [`Active Instagram posts history (${dossier.instagramFact.totalPostsObserved} posts)`] : []),
        ...(dossier.youTubeFact?.totalPostsObserved ? [`Active YouTube channel history (${dossier.youTubeFact.totalPostsObserved} videos)`] : []),
        ...(dossier.tikTokFact?.totalPostsObserved ? [`Active TikTok channel history (${dossier.tikTokFact.totalPostsObserved} videos)`] : []),
        ...(dossier.linkedInFact?.totalPostsObserved ? [`Active LinkedIn channel history (${dossier.linkedInFact.totalPostsObserved} posts)`] : []),
        ...(dossier.websiteFact?.hasProductOffering
          ? [`Verified website product offering${dossier.websiteFact.offeringName ? `: ${dossier.websiteFact.offeringName}` : ""}`]
          : []),
        ...(dossier.sharedChannelAttribution?.hasSharedChannelsAcrossCampaigns
          ? [
              `Shared channel attribution: ${dossier.sharedChannelAttribution.campaignAttributedPostsCount} campaign-attributed posts vs. ${dossier.sharedChannelAttribution.unattributedSharedPostsCount} shared account-level posts`,
            ]
          : []),
      ],
      weakestSignals: candidate.missingCriticalFacts,
      recentTrend:
        finalMode === "BUILD"
          ? "BUILDING_TRACTION"
          : finalMode === "OPTIMIZE"
            ? "STABLE_OPERATIONS"
            : totalSocialPosts > 0
              ? "SOCIAL_ACTIVE_AWAITING_COMMERCIAL_TRUTH"
              : "INSUFFICIENT_DATA",
      activeChannels: [
        { channel: "instagram", status: dossier.instagramFact?.isConnected ? "WINNING" : "NOT_CONNECTED" },
        { channel: "youtube", status: dossier.youTubeFact?.isConnected ? "WINNING" : "NOT_CONNECTED" },
        { channel: "tiktok", status: dossier.tikTokFact?.isConnected ? "WINNING" : "NOT_CONNECTED" },
        {
          channel: "linkedin",
          status:
            dossier.linkedInFact?.isConnected && (dossier.linkedInFact?.totalPostsObserved ?? 0) > 0
              ? "WINNING"
              : dossier.linkedInFact?.isIdentityUnresolved
                ? "NOT_CONNECTED"
                : dossier.linkedInFact?.isConnected
                  ? "UNTESTED"
                  : "NOT_CONNECTED",
        },
        { channel: "website", status: dossier.websiteFact?.hasWebsite ? "WINNING" : "NOT_CONNECTED" },
      ],
      provenAssets: dossier.websiteFact?.hasProductOffering
        ? [`Live website product offering${dossier.websiteFact.offeringName ? ` (${dossier.websiteFact.offeringName})` : ""}`]
        : [],
      proofGaps: candidate.missingCriticalFacts,
      relevantBuyerResponses: [],
      relevantObjections: [],
      confidence: finalConfidence,
      freshness: "FRESH",
      evidenceRefIds,
    })
    .returning();

  // 6. Automatically hand off Performance Context to Adaptive Reasoning Case Coordinator & Notifications
  let reasoningSync: { casesCreated: number; decisionsCreated: number; casesSkippedIdempotent: number } | null = null;
  try {
    reasoningSync = await syncCampaignAdaptiveReasoning({ accountId, campaignId });
  } catch (err) {
    console.warn(`[PerformanceIntelligence] Non-fatal syncCampaignAdaptiveReasoning warn:`, (err as Error)?.message || err);
  }
  try {
    const { syncNotificationsForCampaign } = await import("../notifications-routes");
    await syncNotificationsForCampaign(accountId, campaignId);
  } catch (err) {
    console.warn(`[PerformanceIntelligence] Non-fatal syncNotificationsForCampaign warn:`, (err as Error)?.message || err);
  }

  return {
    executionState,
    clarificationRequest: persistedClarification,
    performanceContext,
    judgeVerdict,
    dossier,
    reasoningSync,
  };
}

export interface StructuredBaselineAnswer {
  operatingDurationMonths?: number | string | null;
  operatingMonths?: number | string | null;
  hasHistoricalPayingCustomers?: boolean | null;
  hasHistoricalPaidCustomers?: boolean | null;
  historicalPayingCustomersCount?: number | string | null;
  historicalPaidCustomersCount?: number | string | null;
  historicalLeadsCount?: number | string | null;
  historicalRevenueAmount?: number | string | null;
  currency?: string;
  notes?: string;
}

export function parseOperatingDurationMonths(raw: unknown): {
  valid: boolean;
  months: number | null;
  error?: string;
} {
  if (raw === null || raw === undefined) {
    return { valid: true, months: null };
  }
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw < 0) {
      return {
        valid: false,
        months: null,
        error: "Operating duration in months must be a non-negative number (e.g. 0, 2, 6).",
      };
    }
    return { valid: true, months: raw };
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed === "") {
      return { valid: true, months: null };
    }
    const lower = trimmed.toLowerCase();
    if (lower === "pre-launch" || lower === "prelaunch") {
      return { valid: true, months: 0 };
    }
    if (/^\d+(?:\.\d+)?$/.test(lower)) {
      return { valid: true, months: Number(lower) };
    }
    const mMatch = lower.match(/^(\d+(?:\.\d+)?)\s*(?:months?|mos?|m)$/);
    if (mMatch) {
      return { valid: true, months: Number(mMatch[1]) };
    }
    const yMatch = lower.match(/^(\d+(?:\.\d+)?)\s*(?:years?|yrs?|y)$/);
    if (yMatch) {
      return { valid: true, months: Math.round(Number(yMatch[1]) * 12 * 10) / 10 };
    }
    return {
      valid: false,
      months: null,
      error: `Invalid operating duration "${raw}". Enter a non-negative number of months (e.g. 6 or "6 months").`,
    };
  }
  return {
    valid: false,
    months: null,
    error: "Invalid operating duration format.",
  };
}

export function parseOptionalWholeCount(
  raw: unknown,
  label: string
): { valid: boolean; value: number | null; error?: string } {
  if (raw === null || raw === undefined) {
    return { valid: true, value: null };
  }
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw < 0 || !Number.isInteger(raw)) {
      return {
        valid: false,
        value: null,
        error: `${label} must be a non-negative whole integer (or left blank if unknown).`,
      };
    }
    return { valid: true, value: raw };
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed === "") {
      return { valid: true, value: null };
    }
    if (!/^\d+$/.test(trimmed)) {
      return {
        valid: false,
        value: null,
        error: `Invalid ${label} "${raw}". Enter a non-negative whole number (or leave blank if unknown).`,
      };
    }
    return { valid: true, value: Number(trimmed) };
  }
  return {
    valid: false,
    value: null,
    error: `Invalid ${label}.`,
  };
}

export function validateAndNormalizeBaselineAnswer(
  structuredInput?: StructuredBaselineAnswer | null,
  rawUserAnswer?: string | null
): {
  normalizedStructured: {
    operatingDurationMonths: number | null;
    operatingMonths: number | null;
    hasHistoricalPayingCustomers: boolean | null;
    hasHistoricalPaidCustomers: boolean | null;
    historicalPayingCustomersCount: number | null;
    historicalPaidCustomersCount: number | null;
    historicalLeadsCount: number | null;
    historicalRevenueAmount: number | null;
    currency: string;
    notes?: string;
  };
  formattedSummary: string;
} {
  const rawText = (rawUserAnswer || "").trim();

  if (structuredInput && typeof structuredInput === "object") {
    const rawDuration =
      structuredInput.operatingDurationMonths !== undefined
        ? structuredInput.operatingDurationMonths
        : structuredInput.operatingMonths;
    const durRes = parseOperatingDurationMonths(rawDuration);
    if (!durRes.valid) {
      throw new BaselineValidationError(durRes.error!, "INVALID_OPERATING_DURATION", 400);
    }

    const rawHasPaid =
      structuredInput.hasHistoricalPayingCustomers !== undefined
        ? structuredInput.hasHistoricalPayingCustomers
        : structuredInput.hasHistoricalPaidCustomers !== undefined
          ? structuredInput.hasHistoricalPaidCustomers
          : null;
    if (rawHasPaid !== null && typeof rawHasPaid !== "boolean") {
      throw new BaselineValidationError(
        "hasHistoricalPayingCustomers must be a boolean (true/false) or null.",
        "INVALID_PAID_CUSTOMERS_FLAG",
        400
      );
    }

    const rawCustCount =
      structuredInput.historicalPayingCustomersCount !== undefined
        ? structuredInput.historicalPayingCustomersCount
        : structuredInput.historicalPaidCustomersCount;
    const custRes = parseOptionalWholeCount(rawCustCount, "Prior paying customers count");
    if (!custRes.valid) {
      throw new BaselineValidationError(custRes.error!, "INVALID_CUSTOMER_COUNT", 400);
    }

    const leadsRes = parseOptionalWholeCount(structuredInput.historicalLeadsCount, "Prior leads count");
    if (!leadsRes.valid) {
      throw new BaselineValidationError(leadsRes.error!, "INVALID_LEADS_COUNT", 400);
    }

    // Contradiction checks
    if (rawHasPaid === false && custRes.value !== null && custRes.value > 0) {
      throw new BaselineValidationError(
        "Contradictory baseline answer: cannot select 'No — Pre-Revenue / 0 Customers' while entering a positive customer count (> 0).",
        "CONTRADICTORY_BASELINE_ANSWER",
        400
      );
    }
    if (rawHasPaid === true && custRes.value === 0) {
      throw new BaselineValidationError(
        "Contradictory baseline answer: cannot select 'Yes — Had Paying Customers' while entering 0 prior paying customers.",
        "CONTRADICTORY_BASELINE_ANSWER",
        400
      );
    }

    // Preserve exact distinctions:
    // - "Yes, had customers" with no count -> hasHistoricalPayingCustomers = true, historicalPayingCustomersCount = null (unknown count, never invented)
    // - "No customers" with no count -> hasHistoricalPayingCustomers = false, historicalPayingCustomersCount = 0
    const finalHasPaid: boolean | null =
      rawHasPaid !== null ? rawHasPaid : custRes.value !== null ? custRes.value > 0 : null;
    const finalCustCount: number | null =
      custRes.value !== null ? custRes.value : finalHasPaid === false ? 0 : null;

    if (durRes.months === null && finalHasPaid === null && leadsRes.value === null && !rawText) {
      throw new BaselineValidationError(
        "Please provide operating history in months or indicate whether your business had prior paying customers.",
        "EMPTY_BASELINE_ANSWER",
        400
      );
    }

    const revNum =
      typeof structuredInput.historicalRevenueAmount === "number" &&
      Number.isFinite(structuredInput.historicalRevenueAmount) &&
      structuredInput.historicalRevenueAmount >= 0
        ? structuredInput.historicalRevenueAmount
        : null;
    const currency = structuredInput.currency || "USD";

    const normalizedStructured = {
      operatingDurationMonths: durRes.months,
      operatingMonths: durRes.months,
      hasHistoricalPayingCustomers: finalHasPaid,
      hasHistoricalPaidCustomers: finalHasPaid,
      historicalPayingCustomersCount: finalCustCount,
      historicalPaidCustomersCount: finalCustCount,
      historicalLeadsCount: leadsRes.value,
      historicalRevenueAmount: revNum,
      currency,
      ...(structuredInput.notes ? { notes: structuredInput.notes } : {}),
    };

    const formattedSummary =
      rawText ||
      [
        typeof durRes.months === "number" ? `Operating duration: ${durRes.months} months` : null,
        finalHasPaid === false
          ? "Historical paying customers: No (0 paying customers)"
          : finalHasPaid === true
            ? `Historical paying customers: Yes${
                typeof finalCustCount === "number" ? ` (${finalCustCount})` : " (exact count unknown)"
              }`
            : null,
        typeof leadsRes.value === "number" ? `Historical leads: ${leadsRes.value}` : null,
        typeof revNum === "number" ? `Historical revenue: ${currency} ${revNum}` : null,
        structuredInput.notes ? `Notes: ${structuredInput.notes}` : null,
      ]
        .filter(Boolean)
        .join(" | ") ||
      "User confirmed baseline";

    return { normalizedStructured, formattedSummary };
  }

  if (!rawText) {
    throw new BaselineValidationError(
      "clarificationRequestId and either userAnswer or structuredAnswer are required.",
      "MISSING_BASELINE_ANSWER",
      400
    );
  }

  const lower = rawText.toLowerCase();
  const indicatesNoSales =
    /\b(no sales|0 sales|zero sales|no customers|0 customers|zero customers|brand new|no paying|not yet|none)\b/.test(
      lower
    ) ||
    lower === "no" ||
    lower === "0";
  const indicatesHasSales =
    !indicatesNoSales && /\b(yes|have customers|paying customers|active sales|generating revenue)\b/.test(lower);

  const monthMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:month|mo)/);
  const yearMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:year|yr)/);
  const custMatch = lower.match(/(\d+)\s*(?:customer|client|sale|buyer)/);
  const leadMatch = lower.match(/(\d+)\s*(?:lead|inquir)/);

  const operatingMonths = yearMatch
    ? Math.round(Number(yearMatch[1]) * 12 * 10) / 10
    : monthMatch
      ? Number(monthMatch[1])
      : null;
  const parsedCustCount = custMatch ? Number(custMatch[1]) : null;

  if (indicatesNoSales && parsedCustCount !== null && parsedCustCount > 0) {
    throw new BaselineValidationError(
      "Contradictory baseline answer: cannot state 'no customers' while providing a positive customer count.",
      "CONTRADICTORY_BASELINE_ANSWER",
      400
    );
  }

  const finalHasPaid = indicatesNoSales
    ? false
    : indicatesHasSales || (parsedCustCount !== null && parsedCustCount > 0)
      ? true
      : null;
  const finalCustCount = indicatesNoSales ? 0 : parsedCustCount;

  return {
    normalizedStructured: {
      operatingDurationMonths: operatingMonths,
      operatingMonths,
      hasHistoricalPayingCustomers: finalHasPaid,
      hasHistoricalPaidCustomers: finalHasPaid,
      historicalPayingCustomersCount: finalCustCount,
      historicalPaidCustomersCount: finalCustCount,
      historicalLeadsCount: leadMatch ? Number(leadMatch[1]) : null,
      historicalRevenueAmount: null,
      currency: "USD",
      notes: rawText,
    },
    formattedSummary: rawText,
  };
}

export async function submitClarificationAnswer(params: {
  clarificationRequestId: string;
  accountId: string;
  campaignId?: string;
  userAnswer?: string;
  structuredAnswer?: StructuredBaselineAnswer;
  simulateDownstreamFailure?: boolean;
  nowOverride?: Date | string;
}): Promise<SubmitClarificationResult> {
  const { clarificationRequestId, accountId, campaignId } = params;

  const [req] = await db
    .select()
    .from(clarificationRequests)
    .where(eq(clarificationRequests.id, clarificationRequestId))
    .limit(1);

  if (!req) {
    throw new BaselineValidationError(
      `ClarificationRequest ${clarificationRequestId} not found.`,
      "CLARIFICATION_NOT_FOUND",
      404
    );
  }

  if (req.accountId && req.accountId !== accountId) {
    throw new BaselineValidationError(
      `ClarificationRequest ${clarificationRequestId} does not belong to the authenticated account.`,
      "TENANT_OWNERSHIP_MISMATCH",
      403
    );
  }

  if (campaignId && req.campaignId !== campaignId) {
    throw new BaselineValidationError(
      `ClarificationRequest ${clarificationRequestId} does not belong to campaign ${campaignId}.`,
      "CAMPAIGN_RELATIONSHIP_MISMATCH",
      400
    );
  }

  const { normalizedStructured, formattedSummary } = validateAndNormalizeBaselineAnswer(
    params.structuredAnswer,
    params.userAnswer
  );

  const now = resolveEffectiveNow(req.campaignId, params.nowOverride);
  const wasAlreadyAnswered = req.status === "ANSWERED";
  const finalStructured = {
    ...normalizedStructured,
    ...(wasAlreadyAnswered ? { _editedAt: now.toISOString() } : {}),
  };

  // STEP 1: Persist the exact validated answer FIRST (separated from downstream evaluation)
  // Mark ANSWERED with answeredAt timestamp and cancel future reminders (nextReminderAt = null).
  const [answeredClarification] = await db
    .update(clarificationRequests)
    .set({
      accountId,
      userAnswer: formattedSummary,
      structuredAnswer: finalStructured as any,
      status: "ANSWERED",
      answeredAt: wasAlreadyAnswered && req.answeredAt ? req.answeredAt : now,
      nextReminderAt: null,
      updatedAt: now,
    })
    .where(eq(clarificationRequests.id, clarificationRequestId))
    .returning();

  // Resolve any other pending baseline requests for the same campaign so reload never recreates or re-prompts
  await db
    .update(clarificationRequests)
    .set({
      status: "RESOLVED",
      nextReminderAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(clarificationRequests.campaignId, req.campaignId),
        eq(clarificationRequests.status, "PENDING")
      )
    );

  // Immediately resolve its pending notification and any reminder notifications
  try {
    await db
      .update(notifications)
      .set({ isRead: true, readAt: now })
      .where(
        and(
          eq(notifications.campaignId, req.campaignId),
          or(
            eq(notifications.sourceEntityId, clarificationRequestId),
            like(notifications.sourceEntityId, `${clarificationRequestId}_reminder_%`)
          )
        )
      );
  } catch {}

  // STEP 2: Run downstream Performance re-evaluation & Deep Reasoning handoff in a guarded block.
  // If downstream evaluation fails, preserve the saved answer and expose DEFERRED_ERROR status cleanly.
  try {
    if (params.simulateDownstreamFailure) {
      throw new Error("Simulated downstream Performance evaluation failure after baseline answer saved.");
    }

    const evalResult = await evaluateAndPersistBusinessExecutionState({
      accountId,
      campaignId: req.campaignId,
      userAnswerContext: `Factual baseline clarification answer for '${req.missingFactType}': ${formattedSummary}`,
    });

    return {
      ...evalResult,
      saved: true,
      clarificationRequestId,
      answeredAt: (answeredClarification?.answeredAt || now).toISOString(),
      answeredClarification: answeredClarification || req,
      evaluationStatus: "COMPLETED",
      evaluationError: null,
    };
  } catch (evalErr: any) {
    console.warn(
      `[PerformanceIntelligence] Baseline answer saved (${clarificationRequestId}), but downstream evaluation deferred:`,
      evalErr?.message || evalErr
    );
    const [latestState] = await db
      .select()
      .from(businessExecutionStates)
      .where(and(eq(businessExecutionStates.accountId, accountId), eq(businessExecutionStates.campaignId, req.campaignId)))
      .orderBy(desc(businessExecutionStates.createdAt))
      .limit(1);
    const [latestContext] = await db
      .select()
      .from(performanceContexts)
      .where(and(eq(performanceContexts.accountId, accountId), eq(performanceContexts.campaignId, req.campaignId)))
      .orderBy(desc(performanceContexts.createdAt))
      .limit(1);

    return {
      saved: true,
      clarificationRequestId,
      answeredAt: (answeredClarification?.answeredAt || now).toISOString(),
      answeredClarification: answeredClarification || req,
      evaluationStatus: "DEFERRED_ERROR",
      evaluationError: evalErr?.message || "Downstream evaluation failed after saving answer.",
      executionState: latestState as any,
      clarificationRequest: null,
      performanceContext: latestContext as any,
      judgeVerdict: {
        judgeAuthorityId: "deferred_after_save",
        status: "INSUFFICIENT_EVIDENCE",
        violations: [],
        rejectionReason: evalErr?.message || null,
        validatedMode: (latestState?.mode as any) || "UNKNOWN",
        validatedBottleneck: (latestState?.primaryBottleneck as any) || "UNKNOWN",
      },
      dossier: null as any,
      reasoningSync: null,
    };
  }
}
