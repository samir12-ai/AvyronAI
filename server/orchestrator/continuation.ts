import crypto from "crypto";
import { db } from "../db";
import {
  orchestratorJobs,
  evidenceManifests,
  campaignOfferings,
  campaignSelections,
  growthCampaigns,
  businessDataLayer,
  brandConfig,
  ciCompetitors,
  miSnapshots,
  marketVoiceEvidence,
  audienceSnapshots,
  differentiationSnapshots,
  positioningSnapshots,
  mechanismSnapshots,
  strategyRoots,
  offerSnapshots,
  awarenessSnapshots,
  funnelSnapshots,
  persuasionSnapshots,
  integritySnapshots,
  strategyValidationSnapshots,
  channelSelectionSnapshots,
  budgetGovernorSnapshots,
  iterationSnapshots,
  retentionSnapshots,
} from "@shared/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { ENGINE_PRIORITY_ORDER, type EngineId } from "./priority-matrix";
import {
  getProviderCircuitBreakerState,
  resetProviderCircuitBreakerForContinuation,
} from "../ai-client";
import { evaluateClaimSemanticEntailment } from "../shared/claim-entailment";
import { areMiSnapshotsCompatibleSync } from "../shared/dependency-contract";

export const STAGE_DISPLAY_NAMES: Record<EngineId, string> = {
  market_intelligence: "Market Intelligence",
  market_voice: "Market Voice",
  audience: "Audience Understanding",
  differentiation: "Differentiation Strategy",
  positioning: "Positioning Strategy",
  mechanism: "Mechanism",
  offer: "Offer Construction",
  awareness: "Awareness Strategy",
  funnel: "Funnel Design",
  persuasion: "Persuasion Framework",
  integrity: "Message Integrity",
  statistical_validation: "Strategy Validation",
  channel_selection: "Channel Selection",
  budget_governor: "Budget Allocation",
  iteration: "Iteration Plan",
  retention: "Retention Strategy",
};

export type InterruptionCategory =
  | "BILLING_EXHAUSTED"
  | "RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "TIMEOUT"
  | "UPSTREAM_HYDRATION_GAP"
  | "MISSING_PREREQUISITE"
  | "CONTEXT_CHANGED"
  | "STAGE_EXECUTION_FAILURE";

export interface InterruptionDiagnostics {
  category: InterruptionCategory;
  isTechnicalInterruption: boolean;
  isBillingExhausted: boolean;
  interruptedStage: EngineId | null;
  interruptedStageLabel: string | null;
  rawError: string | null;
  userTitle: string;
  userMessage: string;
  recoveryActionLabel: string;
}

export interface ReusedStageProvenance {
  engineId: EngineId;
  stageName: string;
  stageNumber: number;
  sourceJobId: string;
  snapshotId: string;
  engineVersion: number;
  accountId: string;
  campaignId: string;
  offeringId: string | null;
  offeringName: string | null;
  targetMarket: string | null;
  contextFingerprint: string | null;
  competitorHash: string | null;
  status: string;
  proposalStatus?: "PROPOSED" | "STRATEGIC_HYPOTHESIS" | "EVIDENCE_BACKED" | "LOCKED";
  selectionReason?: string;
  summary: string | null;
  compatible: boolean;
  wasReused: true;
}

export interface InvalidatedStageInfo {
  engineId: EngineId;
  stageName: string;
  reason: string;
  invalidatedBy: EngineId | "CONTEXT_CHANGE";
}

export interface ExecutionLineageEntry {
  jobId: string;
  status: string;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
  role: "ORIGINAL_RUN" | "FAILED_RETRY" | "CONTINUATION_RUN" | "ACTIVE_CONTINUATION";
}

export interface ContinuationPlan {
  canContinue: boolean;
  campaignId: string;
  accountId: string;
  sourceJobId: string | null;
  latestJobId: string | null;
  activeJobId: string | null;
  strategyRootId: string | null;
  offeringId: string | null;
  offeringName: string | null;
  targetMarket: string | null;
  contextFingerprint: string | null;
  competitorHash: string | null;
  resumeFromStage: EngineId | null;
  resumeFromStageLabel: string | null;
  reusedStages: ReusedStageProvenance[];
  reusedSnapshotIds: Partial<Record<EngineId, string>>;
  remainingStages: Array<{ engineId: EngineId; stageName: string; stageNumber: number }>;
  invalidatedStages: InvalidatedStageInfo[];
  missingPrerequisite: {
    engineId: EngineId;
    stageName: string;
    reason: string;
    recoveryAction: string;
  } | null;
  spuriousRootInvalidationDetected: boolean;
  explanation: string;
  interruptionDiagnostics: InterruptionDiagnostics | null;
  executionLineage: ExecutionLineageEntry[];
}

// Per-campaign in-process continuation lock to prevent duplicate clicks or concurrent tabs
// from launching competing continuation jobs before the DB row is committed.
const activeContinuationLocks = new Map<string, Promise<any>>();

export async function withContinuationLock<T>(
  accountId: string,
  campaignId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = `${accountId}:${campaignId}`;
  const existing = activeContinuationLocks.get(key);
  if (existing) {
    return existing as Promise<T>;
  }
  const promise = (async () => {
    try {
      return await fn();
    } finally {
      activeContinuationLocks.delete(key);
    }
  })();
  activeContinuationLocks.set(key, promise);
  return promise;
}

export function classifyProviderInterruption(
  rawError: string | null | undefined,
  interruptedStage: EngineId | null = null,
): InterruptionDiagnostics {
  const msg = String(rawError || "").trim();
  const stageLabel = interruptedStage ? STAGE_DISPLAY_NAMES[interruptedStage] : null;
  const cb = getProviderCircuitBreakerState();

  const isBilling =
    /no credits remaining|insufficient_quota|billing_hard_limit_reached|credit balance is too low|ai budget exceeded|BILLING_EXHAUSTED/i.test(
      msg,
    ) || cb.openaiCircuitBroken;

  if (isBilling) {
    return {
      category: "BILLING_EXHAUSTED",
      isTechnicalInterruption: true,
      isBillingExhausted: true,
      interruptedStage,
      interruptedStageLabel: stageLabel,
      rawError: msg || cb.openaiBillingExhaustedMessage || "API credits exhausted",
      userTitle: "Service Interruption: API Credits Exhausted",
      userMessage: stageLabel
        ? `Pipeline execution paused at ${stageLabel} because AI provider credits were exhausted. All completed stages have been preserved and will be reused when you continue.`
        : "Pipeline execution paused because AI provider credits were exhausted. All completed stages have been preserved and will be reused when you continue.",
      recoveryActionLabel: "Continue Pipeline",
    };
  }

  if (/429|rate limit|rate-limit|RESOURCE_EXHAUSTED|too many requests/i.test(msg)) {
    return {
      category: "RATE_LIMITED",
      isTechnicalInterruption: true,
      isBillingExhausted: false,
      interruptedStage,
      interruptedStageLabel: stageLabel,
      rawError: msg,
      userTitle: "Service Interruption: Provider Rate Limit",
      userMessage: stageLabel
        ? `Pipeline execution paused at ${stageLabel} due to a temporary AI provider rate limit. Completed stages are preserved and ready to continue.`
        : "Pipeline execution paused due to a temporary AI provider rate limit. Completed stages are preserved and ready to continue.",
      recoveryActionLabel: "Continue Pipeline",
    };
  }

  if (/timeout|timed out|ETIMEDOUT|aborted/i.test(msg)) {
    return {
      category: "TIMEOUT",
      isTechnicalInterruption: true,
      isBillingExhausted: false,
      interruptedStage,
      interruptedStageLabel: stageLabel,
      rawError: msg,
      userTitle: "Service Interruption: Provider Timeout",
      userMessage: stageLabel
        ? `Pipeline execution timed out during ${stageLabel}. Completed upstream stages are preserved and ready to continue.`
        : "Pipeline execution timed out. Completed upstream stages are preserved and ready to continue.",
      recoveryActionLabel: "Continue Pipeline",
    };
  }

  if (/500|502|503|504|UNAVAILABLE|overloaded|high demand|ECONNRESET|ENOTFOUND/i.test(msg)) {
    return {
      category: "PROVIDER_UNAVAILABLE",
      isTechnicalInterruption: true,
      isBillingExhausted: false,
      interruptedStage,
      interruptedStageLabel: stageLabel,
      rawError: msg,
      userTitle: "Service Interruption: AI Provider Unavailable",
      userMessage: stageLabel
        ? `Pipeline execution was interrupted during ${stageLabel} because the AI provider was temporarily unavailable. Completed stages will be reused.`
        : "Pipeline execution was interrupted because the AI provider was temporarily unavailable. Completed stages will be reused.",
      recoveryActionLabel: "Continue Pipeline",
    };
  }

  if (/Blocked at resume_hydration:/i.test(msg)) {
    return {
      category: "UPSTREAM_HYDRATION_GAP",
      isTechnicalInterruption: true,
      isBillingExhausted: false,
      interruptedStage,
      interruptedStageLabel: stageLabel,
      rawError: msg,
      userTitle: "Continuation Ready from Original Run Lineage",
      userMessage: stageLabel
        ? `Previous retry could not attach upstream snapshots for ${stageLabel}. Original run snapshots have been resolved and verified for continuation.`
        : "Previous retry could not attach upstream snapshots. Original run snapshots have been resolved and verified for continuation.",
      recoveryActionLabel: "Continue Pipeline",
    };
  }

  return {
    category: "STAGE_EXECUTION_FAILURE",
    isTechnicalInterruption: false,
    isBillingExhausted: false,
    interruptedStage,
    interruptedStageLabel: stageLabel,
    rawError: msg || null,
    userTitle: stageLabel ? `Pipeline Paused at ${stageLabel}` : "Pipeline Execution Paused",
    userMessage: stageLabel
      ? `Execution stopped at ${stageLabel}${msg ? `: ${msg}` : "."} Valid completed upstream stages will be reused when you continue.`
      : msg || "Execution stopped before completion. Valid completed upstream stages will be reused when you continue.",
    recoveryActionLabel: "Continue Pipeline",
  };
}

function safeJsonParse<T = any>(raw: unknown): T | null {
  if (!raw) return null;
  if (typeof raw === "object") return raw as T;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }
  return null;
}

function isSnapshotStatusValid(engineId: EngineId, status: string | null | undefined, parsedResult: any): boolean {
  const norm = String(status || parsedResult?.status || "").toUpperCase();
  if (!norm) return false;
  if (
    norm === "FAILED" ||
    norm === "ERROR" ||
    norm === "BLOCKED" ||
    norm === "INCOMPLETE" ||
    norm === "CONTRACT_INCOMPLETE" ||
    norm === "INSUFFICIENT_DATA" ||
    norm === "INSUFFICIENT_SIGNALS" ||
    norm === "DEPTH_FAILED" ||
    norm === "AUDIENCE_MISALIGNMENT" ||
    norm === "NO_DISTINCT_MECHANISM_ESTABLISHED"
  ) {
    return false;
  }
  if (engineId === "integrity" && parsedResult && parsedResult.safeToExecute === false) {
    return false;
  }
  return true;
}

export interface ResolveContinuationOptions {
  targetJobId?: string;
  fromStage?: EngineId;
  expectedOfferingName?: string;
  expectedTargetMarket?: string;
  expectedContextFingerprint?: string;
}

/**
 * Resolves the authoritative continuation plan for a campaign/account from persisted state.
 * Uses actual engine dependency relationships and verifies provenance & compatibility.
 */
export async function resolveContinuationPlan(
  accountIdOrCampaignId: string,
  campaignIdOrAccountId: string,
  options?: ResolveContinuationOptions,
): Promise<ContinuationPlan> {
  const isFirstArgCampaign =
    accountIdOrCampaignId.startsWith("camp_") && !campaignIdOrAccountId.startsWith("camp_");
  const accountId = isFirstArgCampaign ? campaignIdOrAccountId : accountIdOrCampaignId;
  const campaignId = isFirstArgCampaign ? accountIdOrCampaignId : campaignIdOrAccountId;

  // 1. Load all orchestrator jobs for this campaign & account
  const allJobs = await db
    .select()
    .from(orchestratorJobs)
    .where(and(eq(orchestratorJobs.accountId, accountId), eq(orchestratorJobs.campaignId, campaignId)))
    .orderBy(desc(orchestratorJobs.createdAt));

  const activeJob = allJobs.find((j) => j.status === "RUNNING" || j.status === "QUEUED") || null;
  const latestJob = options?.targetJobId
    ? allJobs.find((j) => j.id === options.targetJobId) || allJobs[0] || null
    : allJobs[0] || null;

  // 2. Load current campaign, offering, brand config, and active competitors
  const [campaignRow] = await db
    .select()
    .from(growthCampaigns)
    .where(eq(growthCampaigns.id, campaignId))
    .limit(1);

  const [selectionRow] = await db
    .select()
    .from(campaignSelections)
    .where(and(eq(campaignSelections.accountId, accountId), eq(campaignSelections.selectedCampaignId, campaignId)))
    .limit(1);

  const [bdlRow] = await db
    .select()
    .from(businessDataLayer)
    .where(and(eq(businessDataLayer.accountId, accountId), eq(businessDataLayer.campaignId, campaignId)))
    .limit(1);

  const offerings = await db
    .select()
    .from(campaignOfferings)
    .where(and(eq(campaignOfferings.campaignId, campaignId), eq(campaignOfferings.accountId, accountId)))
    .orderBy(desc(campaignOfferings.createdAt));

  const primaryOffering =
    offerings.find((o: any) => o.isSelected || o.isPrimary) || offerings[0] || null;

  const [brandRow] = await db
    .select()
    .from(brandConfig)
    .where(eq(brandConfig.accountId, accountId))
    .limit(1);

  const currentOfferingId = primaryOffering?.id ? String(primaryOffering.id) : null;
  const currentOfferingName =
    options?.expectedOfferingName ??
    primaryOffering?.offeringName ??
    (bdlRow as any)?.heroProduct ??
    (bdlRow as any)?.coreOffer ??
    (bdlRow as any)?.productService ??
    (campaignRow as any)?.productService ??
    (brandRow as any)?.coreProduct ??
    null;

  const currentTargetMarket =
    options?.expectedTargetMarket ??
    selectionRow?.campaignLocation?.trim() ??
    (campaignRow as any)?.targetMarket ??
    (campaignRow as any)?.location ??
    (bdlRow as any)?.businessLocation ??
    (bdlRow as any)?.geography ??
    (brandRow as any)?.targetMarket ??
    (brandRow as any)?.geography ??
    null;

  // 3. Identify the root source job that actually produced the completed snapshots
  // (ignoring empty retry jobs that failed immediately at resume_hydration).
  const manifests = await db
    .select()
    .from(evidenceManifests)
    .where(and(eq(evidenceManifests.accountId, accountId), eq(evidenceManifests.campaignId, campaignId)))
    .orderBy(desc(evidenceManifests.createdAt));

  const audSnapsAll = await db
    .select()
    .from(audienceSnapshots)
    .where(and(eq(audienceSnapshots.accountId, accountId), eq(audienceSnapshots.campaignId, campaignId)))
    .orderBy(desc(audienceSnapshots.createdAt));

  const jobHasSnapshots = (jobId: string) =>
    audSnapsAll.length > 0
      ? audSnapsAll.some((a) => a.jobId === jobId)
      : manifests.some((m) => (m.orchestrationJobId || (m as any).jobId) === jobId);

  let sourceJob: (typeof allJobs)[number] | null = latestJob || null;
  if (
    sourceJob &&
    (/Blocked at resume_hydration:/i.test(String(sourceJob.error || "")) || !jobHasSnapshots(sourceJob.id))
  ) {
    const priorWithSnapshots = allJobs.find(
      (j) =>
        j.id !== sourceJob!.id &&
        !/Blocked at resume_hydration:/i.test(String(j.error || "")) &&
        jobHasSnapshots(j.id),
    );
    if (priorWithSnapshots) {
      sourceJob = priorWithSnapshots;
    }
  }
  if (!sourceJob && audSnapsAll[0]?.jobId) {
    sourceJob = allJobs.find((j) => j.id === audSnapsAll[0].jobId) || null;
  }

  const sourceJobId = sourceJob?.id || latestJob?.id || null;

  // Build execution lineage for diagnostics
  const executionLineage: ExecutionLineageEntry[] = [...allJobs]
    .reverse()
    .map((j) => ({
      jobId: j.id,
      status: j.status,
      error: j.error || null,
      createdAt: j.createdAt ? new Date(j.createdAt).toISOString() : new Date().toISOString(),
      completedAt: j.completedAt ? new Date(j.completedAt).toISOString() : null,
      role:
        j.status === "RUNNING" || j.status === "QUEUED"
          ? "ACTIVE_CONTINUATION"
          : j.id === sourceJobId
            ? "ORIGINAL_RUN"
            : /Blocked at resume_hydration:/i.test(String(j.error || "")) || !jobHasSnapshots(j.id)
              ? "FAILED_RETRY"
              : "CONTINUATION_RUN",
    }));

  const sourceManifest =
    (sourceJobId
      ? manifests.find((m) => (m.orchestrationJobId || (m as any).jobId) === sourceJobId)
      : null) ||
    manifests[0] ||
    null;
  const sourceContextFingerprint = sourceManifest?.contextFingerprint || null;

  // 4. Load snapshots for this campaign/account and index by sourceJobId preference
  const [
    miRows,
    mvRows,
    diffRows,
    posRows,
    mechRows,
    rootRows,
    offerRows,
    awareRows,
    funnelRows,
    persRows,
    integRows,
    svRows,
    csRows,
    bgRows,
    iterRows,
    retRows,
  ] = await Promise.all([
    db
      .select()
      .from(miSnapshots)
      .where(and(eq(miSnapshots.accountId, accountId), eq(miSnapshots.campaignId, campaignId)))
      .orderBy(desc(miSnapshots.createdAt)),
    db
      .select()
      .from(marketVoiceEvidence)
      .where(and(eq(marketVoiceEvidence.accountId, accountId), eq(marketVoiceEvidence.campaignId, campaignId)))
      .limit(25),
    db
      .select()
      .from(differentiationSnapshots)
      .where(
        and(
          eq(differentiationSnapshots.accountId, accountId),
          eq(differentiationSnapshots.campaignId, campaignId),
        ),
      )
      .orderBy(desc(differentiationSnapshots.createdAt)),
    db
      .select()
      .from(positioningSnapshots)
      .where(
        and(eq(positioningSnapshots.accountId, accountId), eq(positioningSnapshots.campaignId, campaignId)),
      )
      .orderBy(desc(positioningSnapshots.createdAt)),
    db
      .select()
      .from(mechanismSnapshots)
      .where(and(eq(mechanismSnapshots.accountId, accountId), eq(mechanismSnapshots.campaignId, campaignId)))
      .orderBy(desc(mechanismSnapshots.createdAt)),
    db
      .select()
      .from(strategyRoots)
      .where(and(eq(strategyRoots.accountId, accountId), eq(strategyRoots.campaignId, campaignId)))
      .orderBy(desc(strategyRoots.createdAt)),
    db
      .select()
      .from(offerSnapshots)
      .where(and(eq(offerSnapshots.accountId, accountId), eq(offerSnapshots.campaignId, campaignId)))
      .orderBy(desc(offerSnapshots.createdAt)),
    db
      .select()
      .from(awarenessSnapshots)
      .where(and(eq(awarenessSnapshots.accountId, accountId), eq(awarenessSnapshots.campaignId, campaignId)))
      .orderBy(desc(awarenessSnapshots.createdAt)),
    db
      .select()
      .from(funnelSnapshots)
      .where(and(eq(funnelSnapshots.accountId, accountId), eq(funnelSnapshots.campaignId, campaignId)))
      .orderBy(desc(funnelSnapshots.createdAt)),
    db
      .select()
      .from(persuasionSnapshots)
      .where(
        and(eq(persuasionSnapshots.accountId, accountId), eq(persuasionSnapshots.campaignId, campaignId)),
      )
      .orderBy(desc(persuasionSnapshots.createdAt)),
    db
      .select()
      .from(integritySnapshots)
      .where(and(eq(integritySnapshots.accountId, accountId), eq(integritySnapshots.campaignId, campaignId)))
      .orderBy(desc(integritySnapshots.createdAt)),
    db
      .select()
      .from(strategyValidationSnapshots)
      .where(
        and(
          eq(strategyValidationSnapshots.accountId, accountId),
          eq(strategyValidationSnapshots.campaignId, campaignId),
        ),
      )
      .orderBy(desc(strategyValidationSnapshots.createdAt)),
    db
      .select()
      .from(channelSelectionSnapshots)
      .where(
        and(
          eq(channelSelectionSnapshots.accountId, accountId),
          eq(channelSelectionSnapshots.campaignId, campaignId),
        ),
      )
      .orderBy(desc(channelSelectionSnapshots.createdAt)),
    db
      .select()
      .from(budgetGovernorSnapshots)
      .where(
        and(
          eq(budgetGovernorSnapshots.accountId, accountId),
          eq(budgetGovernorSnapshots.campaignId, campaignId),
        ),
      )
      .orderBy(desc(budgetGovernorSnapshots.createdAt)),
    db
      .select()
      .from(iterationSnapshots)
      .where(and(eq(iterationSnapshots.accountId, accountId), eq(iterationSnapshots.campaignId, campaignId)))
      .orderBy(desc(iterationSnapshots.createdAt)),
    db
      .select()
      .from(retentionSnapshots)
      .where(and(eq(retentionSnapshots.accountId, accountId), eq(retentionSnapshots.campaignId, campaignId)))
      .orderBy(desc(retentionSnapshots.createdAt)),
  ]);

  const sourceCreatedAtMs = sourceJob?.createdAt ? new Date(sourceJob.createdAt).getTime() : 0;
  const lineageJobsChronological = [...allJobs]
    .filter((j) => {
      if (j.id === sourceJobId || j.id === latestJob?.id) return true;
      const t = j.createdAt ? new Date(j.createdAt).getTime() : 0;
      return sourceCreatedAtMs > 0 && t >= sourceCreatedAtMs;
    })
    .reverse();
  const lineageJobIdSet = new Set(lineageJobsChronological.map((j) => j.id));

  const pickBySourceJob = <T extends { id?: string | null; jobId?: string | null; status?: string | null; result?: unknown }>(
    rows: T[],
    engineId: EngineId = "market_intelligence",
    predicate?: (row: T) => boolean,
    preferredSnapshotId?: string | null,
  ): T | null => {
    const eligibleRows = predicate ? rows.filter(predicate) : rows;
    if (!eligibleRows.length) return null;
    const nonPersistRows =
      engineId === "market_intelligence"
        ? eligibleRows.filter((r) => !String(r.jobId || "").startsWith("persist:"))
        : eligibleRows;
    const pool = nonPersistRows.length > 0 ? nonPersistRows : eligibleRows;
    const tagReason = (row: T, reason: string): T => {
      try {
        (row as any)._selectionReason = reason;
      } catch {}
      return row;
    };
    const isAcquisitionAnchor =
      engineId === "market_intelligence" || engineId === "market_voice" || engineId === "audience";
    if (isAcquisitionAnchor) {
      if (preferredSnapshotId) {
        const preferred = pool.find(
          (r) =>
            r.id === preferredSnapshotId &&
            isSnapshotStatusValid(engineId, r.status || "COMPLETE", safeJsonParse(r.result)),
        );
        if (preferred) return tagReason(preferred, "strategy_root_pinned");
      }
      if (sourceJobId) {
        const exact = pool.find(
          (r) =>
            r.jobId === sourceJobId &&
            isSnapshotStatusValid(engineId, r.status || "COMPLETE", safeJsonParse(r.result)),
        );
        if (exact) return tagReason(exact, "source_job_exact");
      }
    }
    const validInLineage = pool.find(
      (r) =>
        r.jobId &&
        lineageJobIdSet.has(r.jobId) &&
        isSnapshotStatusValid(engineId, r.status || "COMPLETE", safeJsonParse(r.result)),
    );
    if (validInLineage) {
      const reason =
        preferredSnapshotId && validInLineage.id === preferredSnapshotId
          ? "lineage_and_strategy_root_aligned"
          : "lineage_compatible_latest";
      return tagReason(validInLineage, reason);
    }
    if (!isAcquisitionAnchor && preferredSnapshotId) {
      const preferred = pool.find(
        (r) =>
          r.id === preferredSnapshotId &&
          isSnapshotStatusValid(engineId, r.status || "COMPLETE", safeJsonParse(r.result)),
      );
      if (preferred) return tagReason(preferred, "strategy_root_pinned");
    }
    if (!isAcquisitionAnchor && sourceJobId) {
      const exact = pool.find(
        (r) =>
          r.jobId === sourceJobId &&
          isSnapshotStatusValid(engineId, r.status || "COMPLETE", safeJsonParse(r.result)),
      );
      if (exact) return tagReason(exact, "source_job_exact");
    }
    // Only allow fallback to latest row if no upstream foreign-key predicate was required or if predicate explicitly matched
    if (predicate) {
      const validMatched = pool.find((r) =>
        isSnapshotStatusValid(engineId, r.status || "COMPLETE", safeJsonParse(r.result)),
      );
      if (validMatched) return tagReason(validMatched, "predicate_matched_compatible");
    }
    return null;
  };

  const audSnapCandidate =
    pickBySourceJob(audSnapsAll, "audience") ||
    audSnapsAll.find((r) => isSnapshotStatusValid("audience", (r as any).status || "COMPLETE", safeJsonParse((r as any).result))) ||
    audSnapsAll[0] ||
    null;
  const pinnedAudMiId = (audSnapCandidate as any)?.miSnapshotId || null;

  const miSnap =
    (pinnedAudMiId ? miRows.find((r) => r.id === pinnedAudMiId) || null : null) ||
    pickBySourceJob(miRows, "market_intelligence") ||
    miRows.find((r) => !String(r.jobId || "").startsWith("persist:")) ||
    miRows[0] ||
    null;
  const sourceCompetitorHash = miSnap?.competitorHash || null;

  // Check if Strategy Root was spuriously marked REVIEW_REQUIRED by a background MI persist
  // with the exact same competitorHash.
  const activeRoot = rootRows.find((r) => r.status === "ACTIVE") || null;
  const candidateRoot =
    activeRoot ||
    rootRows.find((r) => r.runId && lineageJobIdSet.has(r.runId)) ||
    (sourceJobId ? rootRows.find((r) => r.runId === sourceJobId || (r as any).jobId === sourceJobId) : null) ||
    rootRows.find((r) => r.status === "REVIEW_REQUIRED") ||
    null;

  let spuriousRootInvalidationDetected = false;
  if (candidateRoot && candidateRoot.status === "REVIEW_REQUIRED") {
    const latestMi = miRows[0];
    if (
      latestMi &&
      miSnap &&
      latestMi.competitorHash &&
      miSnap.competitorHash &&
      latestMi.competitorHash === miSnap.competitorHash
    ) {
      spuriousRootInvalidationDetected = true;
    }
  }

  let effectiveStrategyRoot =
    activeRoot || (spuriousRootInvalidationDetected ? candidateRoot : null);
  let strategyRootId = effectiveStrategyRoot?.id || null;

  // 5. Check context compatibility (offering, targetMarket, contextFingerprint)
  const audSnap = audSnapCandidate;
  const audResultParsed = safeJsonParse<any>((audSnap as any)?.result);
  const snapshotOfferingName =
    audResultParsed?.productDna?.productName ||
    audResultParsed?.productDna?.offeringName ||
    primaryOffering?.offeringName ||
    currentOfferingName;

  const contextChangedReasons: string[] = [];
  if (
    options?.expectedContextFingerprint &&
    sourceContextFingerprint &&
    options.expectedContextFingerprint !== sourceContextFingerprint
  ) {
    contextChangedReasons.push(
      `Evidence context fingerprint changed (${sourceContextFingerprint.slice(0, 12)} → ${options.expectedContextFingerprint.slice(0, 12)})`,
    );
  }
  if (
    options?.expectedOfferingName &&
    snapshotOfferingName &&
    options.expectedOfferingName.trim().toLowerCase() !== String(snapshotOfferingName).trim().toLowerCase()
  ) {
    contextChangedReasons.push(
      `Selected offering changed ("${snapshotOfferingName}" → "${options.expectedOfferingName}")`,
    );
  }
  if (
    options?.expectedTargetMarket &&
    currentTargetMarket &&
    options.expectedTargetMarket.trim().toLowerCase() !== String(currentTargetMarket).trim().toLowerCase()
  ) {
    contextChangedReasons.push(
      `Target market changed ("${currentTargetMarket}" → "${options.expectedTargetMarket}")`,
    );
  }

  // Merge section_statuses across sourceJob and any continuation runs in chronological order
  const sourceSectionMap = new Map<string, { id: string; name?: string; status: string; summary?: string }>();
  for (const job of lineageJobsChronological) {
    const statuses: Array<{ id: string; name?: string; status: string; summary?: string }> =
      safeJsonParse<any[]>(job?.sectionStatuses) || [];
    for (const s of statuses) {
      if (!s || !s.id) continue;
      const prev = sourceSectionMap.get(s.id);
      const isPendingOrWaiting = s.status === "PENDING" || s.status === "WAITING";
      if (!prev || !isPendingOrWaiting) {
        sourceSectionMap.set(s.id, s);
      }
    }
  }

  // 6. Walk ENGINE_PRIORITY_ORDER and validate each stage + its dependencies
  const reusedStages: ReusedStageProvenance[] = [];
  const reusedSnapshotIds: Partial<Record<EngineId, string>> = {};
  const reusedSnapshotRows: Partial<Record<EngineId, any>> = {};
  const invalidatedStages: InvalidatedStageInfo[] = [];
  const validStageSet = new Set<EngineId>();
  let earliestInvalidStage: EngineId | null = null;
  let missingPrerequisite: ContinuationPlan["missingPrerequisite"] = null;
  const initialStrategyRoot = effectiveStrategyRoot;

  const forcedStartIdx = options?.fromStage
    ? ENGINE_PRIORITY_ORDER.findIndex((e) => e.id === options.fromStage)
    : -1;

  for (let idx = 0; idx < ENGINE_PRIORITY_ORDER.length; idx++) {
    const engineMeta = ENGINE_PRIORITY_ORDER[idx];
    const engineId = engineMeta.id;
    const stageName = STAGE_DISPLAY_NAMES[engineId];
    const stageNumber = idx + 1;

    // If context incompatibly changed, invalidate from market_intelligence or audience
    if (contextChangedReasons.length > 0) {
      if (!earliestInvalidStage) {
        earliestInvalidStage = "market_intelligence";
      }
      invalidatedStages.push({
        engineId,
        stageName,
        reason: contextChangedReasons.join("; "),
        invalidatedBy: "CONTEXT_CHANGE",
      });
      continue;
    }

    // If caller explicitly requested resuming from this stage or earlier
    if (forcedStartIdx >= 0 && idx >= forcedStartIdx) {
      if (!earliestInvalidStage) {
        earliestInvalidStage = engineId;
      }
      invalidatedStages.push({
        engineId,
        stageName,
        reason: idx === forcedStartIdx
          ? `Requested regeneration starting at ${stageName}`
          : `Downstream of regenerated ${STAGE_DISPLAY_NAMES[ENGINE_PRIORITY_ORDER[forcedStartIdx].id]}`,
        invalidatedBy: ENGINE_PRIORITY_ORDER[forcedStartIdx].id,
      });
      continue;
    }

    // Check if all direct dependencies in ENGINE_PRIORITY_ORDER are in validStageSet
    const brokenDep = (engineMeta.dependencies as readonly EngineId[]).find(
      (depId) => !validStageSet.has(depId),
    );
    if (brokenDep) {
      if (!earliestInvalidStage) {
        earliestInvalidStage = engineId;
      }
      invalidatedStages.push({
        engineId,
        stageName,
        reason: `Requires upstream ${STAGE_DISPLAY_NAMES[brokenDep]} to complete first`,
        invalidatedBy: brokenDep,
      });
      continue;
    }

    // Check persisted snapshot for this stage + foreign-key lineage compatibility against reusedSnapshotIds
    let snapRow: any = null;
    let parsedResult: any = null;
    let snapStatus = "COMPLETE";
    let proposalStatus: ReusedStageProvenance["proposalStatus"] = undefined;
    let incompatibilityReason: string | null = null;
    const secEntry = sourceSectionMap.get(engineId);

    const miLookupForCont = new Map<string, any>(miRows.map((m: any) => [String(m.id), m]));
    const matchesUpstreamLineage = (r: any, requiredKeys: Array<{ col: string; upstreamEngine: EngineId }>): boolean => {
      if (!r) return false;
      const inputSummaryParsed = r.inputSummary ? safeJsonParse<any>(r.inputSummary) : null;
      for (const { col, upstreamEngine } of requiredKeys) {
        const expectedId = reusedSnapshotIds[upstreamEngine];
        const rawActual = r[col] ?? inputSummaryParsed?.[col];
        const actualId = rawActual && rawActual !== "N/A" ? String(rawActual) : null;
        if (expectedId && actualId && actualId !== String(expectedId)) {
          if (upstreamEngine === "market_intelligence") {
            const miCheck = areMiSnapshotsCompatibleSync(actualId, String(expectedId), miLookupForCont);
            if (!miCheck.compatible) return false;
          } else {
            return false;
          }
        }
        // If the snapshot lacked an explicit foreign-key column for a non-acquisition upstream stage,
        // verify it was not paired with a different upstream snapshot in the prior Strategy Root
        // and was not created before the selected upstream snapshot.
        const isAcquisitionUpstream =
          upstreamEngine === "market_intelligence" ||
          upstreamEngine === "market_voice" ||
          upstreamEngine === "audience";
        if (expectedId && !actualId && !isAcquisitionUpstream) {
          const pairedWithDifferentUpstreamInRoot =
            (engineId === "positioning" &&
              upstreamEngine === "differentiation" &&
              rootRows.some(
                (rt: any) =>
                  rt.positioningSnapshotId === r.id &&
                  rt.differentiationSnapshotId &&
                  String(rt.differentiationSnapshotId) !== String(expectedId),
              )) ||
            (engineId === "mechanism" &&
              upstreamEngine === "differentiation" &&
              rootRows.some(
                (rt: any) =>
                  rt.mechanismSnapshotId === r.id &&
                  rt.differentiationSnapshotId &&
                  String(rt.differentiationSnapshotId) !== String(expectedId),
              ));
          if (pairedWithDifferentUpstreamInRoot) {
            return false;
          }
          if (engineId === "positioning" && upstreamEngine === "differentiation") {
            const explicitlyPairedInRoot = rootRows.some(
              (rt: any) =>
                rt.positioningSnapshotId === r.id &&
                String(rt.differentiationSnapshotId) === String(expectedId),
            );
            if (!explicitlyPairedInRoot) {
              return false;
            }
          }
          const upstreamRow = reusedSnapshotRows[upstreamEngine];
          if (upstreamRow && r.jobId !== upstreamRow.jobId) {
            if (upstreamRow.createdAt && r.createdAt) {
              const rMs = new Date(r.createdAt).getTime();
              const upMs = new Date(upstreamRow.createdAt).getTime();
              if (rMs > 0 && upMs > 0 && rMs < upMs - 2000) {
                return false;
              }
            }
          }
        }
      }
      return true;
    };

    switch (engineId) {
      case "market_intelligence": {
        snapRow = miSnap;
        parsedResult = snapRow ? { status: snapRow.status || "COMPLETE" } : null;
        snapStatus = snapRow?.status || "COMPLETE";
        break;
      }
      case "market_voice": {
        const hasMv = mvRows.length > 0 || secEntry?.status === "SUCCESS";
        if (hasMv) {
          snapRow = {
            id: mvRows[0]?.id ? String(mvRows[0].id) : `mv_${sourceJobId || "cached"}`,
            jobId: sourceJobId || mvRows[0]?.discoveryJobId,
            engineVersion: 1,
            status: "COMPLETE",
          };
          parsedResult = { status: "COMPLETE", count: mvRows.length };
        }
        break;
      }
      case "audience": {
        snapRow = audSnap;
        if (
          snapRow &&
          reusedSnapshotIds.market_intelligence &&
          (snapRow as any).miSnapshotId
        ) {
          const audMiCompat = areMiSnapshotsCompatibleSync(
            String((snapRow as any).miSnapshotId),
            String(reusedSnapshotIds.market_intelligence),
            miLookupForCont,
          );
          if (!audMiCompat.compatible) {
            incompatibilityReason = `Audience snapshot miSnapshotId (${(snapRow as any).miSnapshotId}) is incompatible with pinned MI snapshot (${reusedSnapshotIds.market_intelligence}): ${audMiCompat.reason}`;
            snapRow = null;
          }
        }
        parsedResult = audResultParsed;
        snapStatus = (snapRow as any)?.status || parsedResult?.status || "COMPLETE";
        break;
      }
      case "differentiation": {
        snapRow = pickBySourceJob(
          diffRows,
          "differentiation",
          (r: any) =>
            matchesUpstreamLineage(r, [
              { col: "miSnapshotId", upstreamEngine: "market_intelligence" },
              { col: "audienceSnapshotId", upstreamEngine: "audience" },
            ]),
          (effectiveStrategyRoot as any)?.differentiationSnapshotId || null,
        );
        if (!snapRow && diffRows.length > 0) {
          incompatibilityReason = "Differentiation snapshot upstream MI/Audience foreign keys do not match pinned run manifest";
        }
        if (
          snapRow &&
          effectiveStrategyRoot &&
          (effectiveStrategyRoot as any).differentiationSnapshotId &&
          String(snapRow.id) !== String((effectiveStrategyRoot as any).differentiationSnapshotId)
        ) {
          effectiveStrategyRoot = null;
          strategyRootId = null;
        }
        parsedResult = safeJsonParse(snapRow?.result);
        snapStatus = snapRow?.status || parsedResult?.status || "COMPLETE";
        break;
      }
      case "positioning": {
        const audProductDnaCol = safeJsonParse<any>((audSnap as any)?.productDna);
        const rawPtFacts =
          audProductDnaCol?.productTruthFacts ||
          audResultParsed?.productDna?.productTruthFacts ||
          audResultParsed?.productTruthFacts ||
          [];
        const verifiedProductFactStrings: string[] = Array.isArray(rawPtFacts)
          ? rawPtFacts
              .map((f: any) => (typeof f === "string" ? f : f?.statement || f?.claim || f?.fact || ""))
              .filter(Boolean)
          : [];
        const isPositioningOutputValid = (r: any): boolean => {
          const terr = safeJsonParse<any>(r?.territory);
          if (!terr) return true;
          const combinedText = [terr.name, terr.contrastAxis, terr.narrativeDirection, terr.enemyDefinition]
            .filter(Boolean)
            .join(" ");
          if (verifiedProductFactStrings.length > 0 && combinedText) {
            const entailment = evaluateClaimSemanticEntailment(combinedText, verifiedProductFactStrings);
            if (!entailment.isGrounded) {
              return false;
            }
          }
          const inSum = safeJsonParse<any>(r?.inputSummary);
          const comparedCompetitors =
            terr.comparedCompetitorCount ??
            inSum?.comparedCompetitors ??
            inSum?.competitorsCount ??
            null;
          const isUnverifiedComparison =
            comparedCompetitors === 0 ||
            terr.comparisonStatus === "INSUFFICIENT_COMPARISON_EVIDENCE" ||
            terr.epistemicStatus === "PROPOSED" ||
            r?.epistemicStatus === "PROPOSED";
          if (
            isUnverifiedComparison &&
            /\b(every|all)\s+(competitors?|alternatives?)\b/i.test(combinedText)
          ) {
            return false;
          }
          return true;
        };
        snapRow = pickBySourceJob(
          posRows,
          "positioning",
          (r: any) =>
            matchesUpstreamLineage(r, [
              { col: "miSnapshotId", upstreamEngine: "market_intelligence" },
              { col: "audienceSnapshotId", upstreamEngine: "audience" },
              { col: "differentiationSnapshotId", upstreamEngine: "differentiation" },
            ]) && isPositioningOutputValid(r),
          (effectiveStrategyRoot as any)?.positioningSnapshotId || null,
        );
        if (!snapRow && posRows.length > 0) {
          incompatibilityReason = "Positioning snapshot failed semantic entailment/competitor-scope validation or upstream MI/Audience/Differentiation foreign keys do not match pinned run manifest";
        }
        if (
          snapRow &&
          effectiveStrategyRoot &&
          (effectiveStrategyRoot as any).positioningSnapshotId &&
          String(snapRow.id) !== String((effectiveStrategyRoot as any).positioningSnapshotId)
        ) {
          effectiveStrategyRoot = null;
          strategyRootId = null;
        }
        parsedResult = safeJsonParse(snapRow?.result);
        snapStatus = snapRow?.status || parsedResult?.status || "COMPLETE";
        // Preserve proposed strategy status without rejecting it
        const rawEpistemic =
          (snapRow as any)?.epistemicStatus ||
          parsedResult?.epistemicStatus ||
          parsedResult?.proposalStatus ||
          parsedResult?.recommendedTerritory?.proposalStatus;
        if (
          rawEpistemic === "PROPOSED" ||
          rawEpistemic === "STRATEGIC_HYPOTHESIS" ||
          String(snapStatus).toUpperCase() === "PARTIAL"
        ) {
          proposalStatus = "PROPOSED";
        } else if (rawEpistemic === "EVIDENCE_BACKED") {
          proposalStatus = "EVIDENCE_BACKED";
        }
        break;
      }
      case "mechanism": {
        snapRow = pickBySourceJob(
          mechRows,
          "mechanism",
          (r: any) =>
            matchesUpstreamLineage(r, [
              { col: "audienceSnapshotId", upstreamEngine: "audience" },
              { col: "differentiationSnapshotId", upstreamEngine: "differentiation" },
              { col: "positioningSnapshotId", upstreamEngine: "positioning" },
            ]),
          (effectiveStrategyRoot as any)?.mechanismSnapshotId || null,
        );
        if (!snapRow && mechRows.length > 0) {
          incompatibilityReason = "Mechanism snapshot upstream Positioning/Differentiation/Audience foreign keys do not match pinned run manifest";
        }
        if (
          snapRow &&
          effectiveStrategyRoot &&
          (effectiveStrategyRoot as any).mechanismSnapshotId &&
          String(snapRow.id) !== String((effectiveStrategyRoot as any).mechanismSnapshotId)
        ) {
          effectiveStrategyRoot = null;
          strategyRootId = null;
        }
        parsedResult = safeJsonParse(snapRow?.result);
        snapStatus = snapRow?.status || parsedResult?.status || "COMPLETE";
        if (!effectiveStrategyRoot) {
          if (snapRow && !incompatibilityReason) {
            incompatibilityReason = "Strategy Root references superseded upstream snapshots and must be rebuilt from Mechanism";
          }
          snapRow = null;
          if (!missingPrerequisite) {
            missingPrerequisite = {
              engineId: "mechanism",
              stageName: STAGE_DISPLAY_NAMES.mechanism,
              reason: "Active Strategy Root is missing or superseded by newer upstream snapshots before downstream stages can execute.",
              recoveryAction: "Continue from Mechanism to rebuild and lock the Strategy Root.",
            };
          }
        }
        break;
      }
      case "offer": {
        const offerPred = (r: any) =>
          Boolean(strategyRootId && r.strategyRootId === strategyRootId) &&
          matchesUpstreamLineage(r, [
            { col: "audienceSnapshotId", upstreamEngine: "audience" },
            { col: "differentiationSnapshotId", upstreamEngine: "differentiation" },
            { col: "positioningSnapshotId", upstreamEngine: "positioning" },
          ]);
        snapRow =
          (strategyRootId ? offerRows.find((r) => r.strategyRootId === strategyRootId && offerPred(r)) : null) ||
          pickBySourceJob(offerRows, "offer", offerPred);
        if (!snapRow && offerRows.length > 0) {
          incompatibilityReason = "Offer snapshot upstream lineage does not match pinned run manifest";
        }
        parsedResult = safeJsonParse(snapRow?.result);
        snapStatus = snapRow?.status || parsedResult?.status || "COMPLETE";
        if (
          snapRow?.statusMessage?.startsWith("Review required:") &&
          !spuriousRootInvalidationDetected
        ) {
          snapRow = null;
        }
        break;
      }
      case "awareness": {
        const awarePred = (r: any) =>
          Boolean(strategyRootId && (r as any).strategyRootId === strategyRootId) &&
          matchesUpstreamLineage(r, [
            { col: "audienceSnapshotId", upstreamEngine: "audience" },
            { col: "positioningSnapshotId", upstreamEngine: "positioning" },
            { col: "offerSnapshotId", upstreamEngine: "offer" },
          ]);
        snapRow =
          (strategyRootId ? awareRows.find((r) => (r as any).strategyRootId === strategyRootId && awarePred(r)) : null) ||
          pickBySourceJob(awareRows, "awareness", awarePred);
        if (!snapRow && awareRows.length > 0) {
          incompatibilityReason = "Awareness snapshot upstream lineage does not match pinned run manifest";
        }
        parsedResult = safeJsonParse(snapRow?.result);
        snapStatus = snapRow?.status || parsedResult?.status || "COMPLETE";
        if (
          snapRow?.statusMessage?.startsWith("Review required:") &&
          !spuriousRootInvalidationDetected
        ) {
          snapRow = null;
        }
        break;
      }
      case "funnel": {
        const funnelPred = (r: any) =>
          Boolean(strategyRootId && r.strategyRootId === strategyRootId) &&
          matchesUpstreamLineage(r, [
            { col: "audienceSnapshotId", upstreamEngine: "audience" },
            { col: "positioningSnapshotId", upstreamEngine: "positioning" },
            { col: "offerSnapshotId", upstreamEngine: "offer" },
            { col: "awarenessSnapshotId", upstreamEngine: "awareness" },
          ]);
        snapRow =
          (strategyRootId ? funnelRows.find((r) => r.strategyRootId === strategyRootId && funnelPred(r)) : null) ||
          pickBySourceJob(funnelRows, "funnel", funnelPred);
        if (!snapRow && funnelRows.length > 0) {
          incompatibilityReason = "Funnel snapshot upstream lineage does not match pinned run manifest";
        }
        parsedResult = safeJsonParse(snapRow?.result);
        snapStatus = snapRow?.status || parsedResult?.status || "COMPLETE";
        if (
          snapRow?.statusMessage?.startsWith("Review required:") &&
          !spuriousRootInvalidationDetected
        ) {
          snapRow = null;
        }
        break;
      }
      case "persuasion": {
        const persPred = (r: any) =>
          Boolean(strategyRootId && (r as any).strategyRootId === strategyRootId) &&
          matchesUpstreamLineage(r, [
            { col: "audienceSnapshotId", upstreamEngine: "audience" },
            { col: "positioningSnapshotId", upstreamEngine: "positioning" },
            { col: "offerSnapshotId", upstreamEngine: "offer" },
          ]);
        snapRow =
          (strategyRootId ? persRows.find((r) => (r as any).strategyRootId === strategyRootId && persPred(r)) : null) ||
          pickBySourceJob(persRows, "persuasion", persPred);
        if (!snapRow && persRows.length > 0) {
          incompatibilityReason = "Persuasion snapshot upstream lineage does not match pinned run manifest";
        }
        parsedResult = safeJsonParse(snapRow?.result);
        snapStatus = snapRow?.status || parsedResult?.status || "COMPLETE";
        break;
      }
      case "integrity": {
        const integPred = (r: any) =>
          Boolean(strategyRootId && r.strategyRootId === strategyRootId);
        snapRow =
          (strategyRootId ? integRows.find((r) => r.strategyRootId === strategyRootId) : null) ||
          pickBySourceJob(integRows, "integrity", integPred);
        parsedResult = safeJsonParse(snapRow?.result);
        snapStatus = snapRow?.status || parsedResult?.status || "COMPLETE";
        break;
      }
      case "statistical_validation": {
        snapRow = pickBySourceJob(svRows, "statistical_validation");
        parsedResult = safeJsonParse(snapRow?.result);
        snapStatus = snapRow?.status || parsedResult?.status || "COMPLETE";
        break;
      }
      case "channel_selection": {
        snapRow = pickBySourceJob(csRows, "channel_selection");
        parsedResult = safeJsonParse(snapRow?.result);
        snapStatus = snapRow?.status || parsedResult?.status || "COMPLETE";
        break;
      }
      case "budget_governor": {
        snapRow = pickBySourceJob(bgRows, "budget_governor");
        parsedResult = safeJsonParse(snapRow?.result);
        snapStatus = snapRow?.status || parsedResult?.status || "COMPLETE";
        // If budget_governor was recorded as ERROR/BLOCKED/RUNNING in the interrupted job's section_statuses,
        // treat budget_governor as the interrupted stage to resume from so it + iteration + retention + synthesis complete.
        if (
          secEntry &&
          (secEntry.status === "ERROR" ||
            secEntry.status === "BLOCKED" ||
            secEntry.status === "FAILED" ||
            secEntry.status === "RUNNING")
        ) {
          snapRow = null;
        }
        break;
      }
      case "iteration": {
        snapRow = pickBySourceJob(iterRows, "iteration");
        parsedResult = safeJsonParse(snapRow?.result);
        snapStatus = snapRow?.status || parsedResult?.status || "COMPLETE";
        if (
          !snapRow &&
          secEntry &&
          (secEntry.status === "SKIPPED_AWAITING_LIVE_DATA" || secEntry.status === "SUCCESS")
        ) {
          // Only mark iteration reused if budget_governor was also valid and the job actually completed
          if (sourceJob?.status === "COMPLETED") {
            snapRow = {
              id: `iter_skipped_${sourceJobId}`,
              jobId: sourceJobId,
              engineVersion: 1,
              status: "SKIPPED_AWAITING_LIVE_DATA",
            };
            parsedResult = { status: "SKIPPED_AWAITING_LIVE_DATA" };
          }
        }
        break;
      }
      case "retention": {
        snapRow = pickBySourceJob(retRows, "retention");
        parsedResult = safeJsonParse(snapRow?.result);
        snapStatus = snapRow?.status || parsedResult?.status || "COMPLETE";
        if (
          !snapRow &&
          secEntry &&
          (secEntry.status === "SKIPPED_AWAITING_LIVE_DATA" || secEntry.status === "SUCCESS")
        ) {
          if (sourceJob?.status === "COMPLETED") {
            snapRow = {
              id: `ret_skipped_${sourceJobId}`,
              jobId: sourceJobId,
              engineVersion: 1,
              status: "SKIPPED_AWAITING_LIVE_DATA",
            };
            parsedResult = { status: "SKIPPED_AWAITING_LIVE_DATA" };
          }
        }
        break;
      }
    }

    const valid =
      snapRow !== null &&
      isSnapshotStatusValid(engineId, snapStatus, parsedResult) &&
      secEntry?.status !== "ERROR" &&
      secEntry?.status !== "FAILED";

    if (!valid) {
      if (incompatibilityReason) {
        invalidatedStages.push({
          engineId,
          stageName,
          reason: incompatibilityReason,
          invalidatedBy: "CONTEXT_CHANGE",
        });
      }
      if (!earliestInvalidStage) {
        earliestInvalidStage = engineId;
        const hasLaterCompletedStage = ENGINE_PRIORITY_ORDER.slice(idx + 1).some((later) => {
          const s = sourceSectionMap.get(later.id)?.status;
          return s === "SUCCESS" || s === "COMPLETED" || s === "COMPLETE" || s === "PARTIAL";
        });
        if (!missingPrerequisite && ((forcedStartIdx >= 0 && idx < forcedStartIdx) || hasLaterCompletedStage)) {
          missingPrerequisite = {
            engineId,
            stageName,
            reason: incompatibilityReason || `Required upstream ${stageName} snapshot is missing or invalid.`,
            recoveryAction: `Continue from ${stageName} to recompute this prerequisite and its dependent stages.`,
          };
        }
      }
      continue;
    }

    validStageSet.add(engineId);
    const resolvedSnapId = String(snapRow.id);
    reusedSnapshotIds[engineId] = resolvedSnapId;
    reusedSnapshotRows[engineId] = snapRow;

    reusedStages.push({
      engineId,
      stageName,
      stageNumber,
      sourceJobId: String(snapRow.jobId || sourceJobId || "unknown"),
      snapshotId: resolvedSnapId,
      engineVersion: Number(snapRow.engineVersion || 1),
      accountId,
      campaignId,
      offeringId: currentOfferingId,
      offeringName: snapshotOfferingName ? String(snapshotOfferingName) : null,
      targetMarket: currentTargetMarket ? String(currentTargetMarket) : null,
      contextFingerprint: sourceContextFingerprint,
      competitorHash: sourceCompetitorHash,
      status: snapStatus,
      proposalStatus,
      selectionReason: (snapRow as any)?._selectionReason || "lineage_compatible",
      summary: secEntry?.summary || snapRow.statusMessage || null,
      compatible: true,
      wasReused: true,
    });
  }

  if (contextChangedReasons.length > 0 && !missingPrerequisite) {
    missingPrerequisite = {
      engineId: "market_intelligence",
      stageName: STAGE_DISPLAY_NAMES.market_intelligence,
      reason: contextChangedReasons.join("; "),
      recoveryAction: "Restart from Market Intelligence so all stages align with the updated campaign context.",
    };
  }

  const resumeFromStage: EngineId | null = earliestInvalidStage;
  const resumeFromStageLabel = resumeFromStage ? STAGE_DISPLAY_NAMES[resumeFromStage] : null;

  const remainingStages = resumeFromStage
    ? ENGINE_PRIORITY_ORDER.slice(
        ENGINE_PRIORITY_ORDER.findIndex((e) => e.id === resumeFromStage),
      ).map((e) => ({
        engineId: e.id,
        stageName: STAGE_DISPLAY_NAMES[e.id],
        stageNumber: ENGINE_PRIORITY_ORDER.findIndex((x) => x.id === e.id) + 1,
      }))
    : [];

  // Determine interruption diagnostics from sourceJob and latestJob
  const combinedError =
    latestJob?.error && !/Blocked at resume_hydration:/i.test(latestJob.error)
      ? latestJob.error
      : sourceJob?.error || latestJob?.error || null;

  const interruptionDiagnostics =
    sourceJob && sourceJob.status !== "COMPLETED"
      ? classifyProviderInterruption(combinedError, resumeFromStage)
      : null;

  // Build accurate dynamic explanation for UI & API
  let explanation = "";
  if (contextChangedReasons.length > 0) {
    explanation = `Cannot reuse previous snapshots because campaign context changed (${contextChangedReasons.join("; ")}). Restarting from Market Intelligence.`;
  } else if (!resumeFromStage) {
    explanation = "All pipeline stages are complete.";
  } else if (reusedStages.length > 0) {
    if (missingPrerequisite || (invalidatedStages.length > 0 && options?.fromStage && resumeFromStage !== options.fromStage)) {
      explanation = `Continue from ${resumeFromStageLabel} (earliest affected prerequisite). ${reusedStages.length} completed stage${reusedStages.length === 1 ? "" : "s"} will be reused; ${remainingStages.length} stage${remainingStages.length === 1 ? "" : "s"} will be recomputed.`;
    } else {
      explanation = `Continue from ${resumeFromStageLabel}. ${reusedStages.length} completed stage${reusedStages.length === 1 ? "" : "s"} will be reused.`;
    }
  } else {
    explanation = `Start pipeline from ${resumeFromStageLabel}.`;
  }

  const canContinue =
    contextChangedReasons.length === 0 &&
    resumeFromStage !== null &&
    (reusedStages.length > 0 || (allJobs.length > 0 && allJobs[0].status !== "COMPLETED"));

  return {
    canContinue,
    campaignId,
    accountId,
    sourceJobId,
    latestJobId: latestJob?.id || null,
    activeJobId: activeJob?.id || null,
    strategyRootId,
    offeringId: currentOfferingId,
    offeringName: currentOfferingName ? String(currentOfferingName) : null,
    targetMarket: currentTargetMarket ? String(currentTargetMarket) : null,
    contextFingerprint: sourceContextFingerprint,
    competitorHash: sourceCompetitorHash,
    resumeFromStage,
    resumeFromStageLabel,
    reusedStages,
    reusedSnapshotIds,
    remainingStages,
    invalidatedStages,
    missingPrerequisite,
    spuriousRootInvalidationDetected,
    explanation,
    interruptionDiagnostics,
    executionLineage,
  };
}

/**
 * Prepares persisted state right before launching a continuation job:
 * 1. Resets process-local provider circuit breaker state so restored credits can be used immediately.
 * 2. Restores a Strategy Root and downstream snapshots that were spuriously marked REVIEW_REQUIRED
 *    by a background MI persist when competitorHash was unchanged.
 * Note: Never rewrites historical strategyRootId on incompatible snapshots.
 */
export async function prepareContinuationState(plan: ContinuationPlan): Promise<void> {
  resetProviderCircuitBreakerForContinuation();

  if (plan.spuriousRootInvalidationDetected && plan.strategyRootId) {
    await db
      .update(strategyRoots)
      .set({ status: "ACTIVE" })
      .where(
        and(
          eq(strategyRoots.id, plan.strategyRootId),
          eq(strategyRoots.accountId, plan.accountId),
          eq(strategyRoots.campaignId, plan.campaignId),
        ),
      );

    // Clear spurious "Review required: upstream mi engine regenerated..." messages on offer, awareness, funnel
    for (const table of [offerSnapshots, awarenessSnapshots, funnelSnapshots] as const) {
      const rows = await db
        .select()
        .from(table)
        .where(
          and(
            eq(table.accountId, plan.accountId),
            eq(table.campaignId, plan.campaignId),
          ),
        );
      for (const row of rows) {
        if (
          typeof row.statusMessage === "string" &&
          row.statusMessage.startsWith("Review required: upstream mi engine regenerated")
        ) {
          await db
            .update(table)
            .set({ statusMessage: null })
            .where(eq(table.id, row.id));
        }
      }
    }
  }
}
