/**
 * Adaptive Case Coordinator
 * 
 * Constitutional Principle:
 * Connects Watchtower Market Signals and Performance Signals into unified,
 * root-pinned Reasoning Cases without creating duplicate data authorities.
 * Handles Watchtower state transitions (Candidate -> Confirmed -> Contradicted/Closed).
 */

import {
  AdaptiveSignal,
  ReasoningCase,
  ReasoningCaseStatus,
  StrategicAuthorityName,
  WatchtowerConfirmationState,
} from "./contracts";
import { validateCampaignContainment, validateStrategyRootReference, LineageIntegrityError } from "./lineage";
import { createHash, randomUUID } from "crypto";
import { db } from "../db";
import * as schema from "@shared/schema";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { adaptPerformanceContextToSignals, adaptWatchtowerEventToAdaptiveSignal } from "./adapters";
import { runCausalReasoningAnalysis } from "./reasoning-engine";
import { judgeReasoningAnalysis } from "./reasoning-judge";
import { routeAdaptiveDecision } from "./router";
import { validateBriefDeterministic } from "../watchtower/strategic-brief-generator";

export interface CreateCaseParams {
  accountId: string;
  campaignId: string;
  strategyRootId: string;
  strategyRootVersion: number;
  marketSignals?: AdaptiveSignal[];
  performanceSignals?: AdaptiveSignal[];
  reasoningVersion?: string;
  metadata?: Record<string, any>;
}

/**
 * Creates a new canonical ReasoningCase correlating market and performance signals.
 */
export function openReasoningCase(params: CreateCaseParams): ReasoningCase {
  const {
    accountId,
    campaignId,
    strategyRootId,
    strategyRootVersion,
    marketSignals = [],
    performanceSignals = [],
    reasoningVersion = "1.0.0",
    metadata = {},
  } = params;

  // 1. Cross-campaign isolation check on all incoming signals
  for (const sig of [...marketSignals, ...performanceSignals]) {
    validateCampaignContainment(sig, campaignId, accountId);
  }

  // 2. Validate Root Pinning
  validateStrategyRootReference({ strategyRootId, strategyRootVersion }, "ReasoningCase");

  const marketSignalIds = Array.from(new Set(marketSignals.map(s => s.signalId)));
  const performanceSignalIds = Array.from(new Set(performanceSignals.map(s => s.signalId)));

  const marketEventIds = Array.from(new Set(marketSignals.map(s => s.sourceArtifactId)));
  const performanceContextIds = Array.from(new Set(performanceSignals.map(s => s.sourceArtifactId)));

  const evidenceIds = Array.from(
    new Set([
      ...marketSignals.flatMap(s => s.evidenceIds),
      ...performanceSignals.flatMap(s => s.evidenceIds),
    ])
  );

  const reasoningCase: ReasoningCase = {
    reasoningCaseId: `rcase_${randomUUID().slice(0, 12)}`,
    accountId,
    campaignId,
    strategyRootId,
    strategyRootVersion,
    marketSignalIds,
    performanceSignalIds,
    marketEventIds,
    performanceWarningIds: performanceSignalIds, // Discrete performance warning signal IDs
    evidenceIds,
    status: "OPEN",
    openedAt: new Date().toISOString(),
    resolvedAt: null,
    reasoningVersion,
    hypotheses: [],
    candidateAffectedAuthorities: [],
    metadata: {
      ...metadata,
      performanceContextIds,
      marketSignalCount: marketSignals.length,
      performanceSignalCount: performanceSignals.length,
    },
  };

  return reasoningCase;
}

/**
 * Handles Watchtower Confirmation Lifecycle Transitions on an existing Reasoning Case.
 * 
 * If a candidate market event is:
 * - CONFIRMED: Lineage is updated to CONFIRMED.
 * - CONTRADICTED / CLOSED / REVERTED: Case relying on that candidate is downgraded or closed.
 */
export function handleWatchtowerEventTransition(
  existingCase: ReasoningCase,
  updatedMarketSignal: AdaptiveSignal
): { updatedCase: ReasoningCase; transitionAction: "MAINTAIN" | "DOWNGRADE" | "CLOSE" } {
  validateCampaignContainment(updatedMarketSignal, existingCase.campaignId, existingCase.accountId);

  const confirmationState = updatedMarketSignal.confirmationState;
  const isTargetSignal = existingCase.marketEventIds.includes(updatedMarketSignal.sourceArtifactId) ||
    (existingCase.marketSignalIds || []).includes(updatedMarketSignal.signalId);

  if (!isTargetSignal) {
    return { updatedCase: existingCase, transitionAction: "MAINTAIN" };
  }

  const updatedCase: ReasoningCase = {
    ...existingCase,
    metadata: {
      ...(existingCase.metadata || {}),
      lastEventTransition: {
        signalId: updatedMarketSignal.signalId,
        confirmationState,
        transitionedAt: new Date().toISOString(),
      },
    },
  };

  if (confirmationState === "CONTRADICTED" || confirmationState === "CLOSED" || confirmationState === "REVERTED" || confirmationState === "EXPIRED") {
    // If there are no performance signals remaining, close the case as INSUFFICIENT_EVIDENCE
    const remainingSignals = (existingCase.performanceSignalIds || []).length;
    if (remainingSignals === 0) {
      updatedCase.status = "CLOSED";
      updatedCase.resolvedAt = new Date().toISOString();
      updatedCase.metadata.closedReason = `Watchtower candidate ${updatedMarketSignal.sourceArtifactId} was ${confirmationState}. No remaining empirical evidence.`;
      return { updatedCase, transitionAction: "CLOSE" };
    } else {
      // Downgrade hypotheses relying exclusively on this market candidate
      updatedCase.hypotheses = (updatedCase.hypotheses || []).map(h => {
        if (h.supportingEvidenceIds.some(ev => updatedMarketSignal.evidenceIds.includes(ev))) {
          return { ...h, status: "REJECTED" as const, confidence: 0.1 };
        }
        return h;
      });
      return { updatedCase, transitionAction: "DOWNGRADE" };
    }
  }

  if (confirmationState === "CONFIRMED") {
    // Elevate confidence on hypotheses matching confirmed event
    updatedCase.metadata.eventConfirmedAt = new Date().toISOString();
    return { updatedCase, transitionAction: "MAINTAIN" };
  }

  return { updatedCase, transitionAction: "MAINTAIN" };
}

export interface DesignatedActiveLineage {
  strategicPlan: typeof schema.strategicPlans.$inferSelect | null;
  rootBundle: typeof schema.rootBundles.$inferSelect | null;
  activeRoot: typeof schema.strategyRoots.$inferSelect | null;
  strategyRootId: string | null;
  strategyRootVersion: number;
  strategyRootInternalVersion: number;
  rootBundleId: string | null;
  rootBundleVersion: number;
  planId: string | null;
  planVersion: number;
  productId: string | null;
}

/**
 * Resolves the authoritative active strategy lineage for a campaign through
 * the designated active strategic plan (`isDesignatedActive = true` / `executionStatus = 'ACTIVE'`)
 * -> its pinned `rootBundleId` -> its pinned `strategyRootId`, rather than `ORDER BY created_at DESC LIMIT 1`.
 */
export async function resolveDesignatedActiveLineage(
  campaignId: string,
  accountId?: string | null,
): Promise<DesignatedActiveLineage> {
  // 1. Find designated active strategic plan first
  const planConds = [
    eq(schema.strategicPlans.campaignId, campaignId),
    or(
      eq(schema.strategicPlans.isDesignatedActive, true),
      eq(schema.strategicPlans.executionStatus, "ACTIVE"),
      eq(schema.strategicPlans.status, "APPROVED"),
      eq(schema.strategicPlans.status, "ACTIVE"),
    ),
  ];
  if (accountId) {
    planConds.push(eq(schema.strategicPlans.accountId, accountId));
  }

  let [strategicPlan] = await db
    .select()
    .from(schema.strategicPlans)
    .where(and(...planConds))
    .orderBy(
      desc(schema.strategicPlans.isDesignatedActive),
      desc(schema.strategicPlans.version),
      desc(schema.strategicPlans.createdAt),
    )
    .limit(1);

  if (!strategicPlan) {
    [strategicPlan] = await db
      .select()
      .from(schema.strategicPlans)
      .where(eq(schema.strategicPlans.campaignId, campaignId))
      .orderBy(desc(schema.strategicPlans.isDesignatedActive), desc(schema.strategicPlans.createdAt))
      .limit(1);
  }

  // 2. Resolve Root Bundle via strategicPlan.rootBundleId first
  let rootBundle: typeof schema.rootBundles.$inferSelect | undefined;
  if (strategicPlan?.rootBundleId) {
    [rootBundle] = await db
      .select()
      .from(schema.rootBundles)
      .where(eq(schema.rootBundles.id, strategicPlan.rootBundleId))
      .limit(1);
  }
  if (!rootBundle && strategicPlan?.rootBundleVersion) {
    [rootBundle] = await db
      .select()
      .from(schema.rootBundles)
      .where(
        and(
          eq(schema.rootBundles.campaignId, campaignId),
          eq(schema.rootBundles.version, strategicPlan.rootBundleVersion),
        ),
      )
      .orderBy(desc(schema.rootBundles.createdAt))
      .limit(1);
  }
  if (!rootBundle) {
    [rootBundle] = await db
      .select()
      .from(schema.rootBundles)
      .where(
        and(
          eq(schema.rootBundles.campaignId, campaignId),
          eq(schema.rootBundles.status, "ACTIVE"),
        ),
      )
      .orderBy(desc(schema.rootBundles.version), desc(schema.rootBundles.createdAt))
      .limit(1);
  }
  if (!rootBundle) {
    [rootBundle] = await db
      .select()
      .from(schema.rootBundles)
      .where(eq(schema.rootBundles.campaignId, campaignId))
      .orderBy(desc(schema.rootBundles.createdAt))
      .limit(1);
  }

  // 3. Resolve Strategy Root via rootBundle.strategyRootId first
  let activeRoot: typeof schema.strategyRoots.$inferSelect | undefined;
  if ((rootBundle as any)?.strategyRootId) {
    [activeRoot] = await db
      .select()
      .from(schema.strategyRoots)
      .where(eq(schema.strategyRoots.id, (rootBundle as any).strategyRootId))
      .limit(1);
  }
  if (!activeRoot) {
    [activeRoot] = await db
      .select()
      .from(schema.strategyRoots)
      .where(
        and(
          eq(schema.strategyRoots.campaignId, campaignId),
          inArray(schema.strategyRoots.status, ["ACTIVE", "REVIEW_REQUIRED"]),
        ),
      )
      .orderBy(desc(schema.strategyRoots.createdAt))
      .limit(1);
  }
  if (!activeRoot) {
    [activeRoot] = await db
      .select()
      .from(schema.strategyRoots)
      .where(eq(schema.strategyRoots.campaignId, campaignId))
      .orderBy(desc(schema.strategyRoots.createdAt))
      .limit(1);
  }

  let resolvedProductId: string | null =
    (strategicPlan as any)?.productId ??
    (rootBundle as any)?.productId ??
    (activeRoot as any)?.productId ??
    null;
  if (!resolvedProductId) {
    try {
      const [campSel] = await db
        .select({ productId: schema.campaignSelections.productId })
        .from(schema.campaignSelections)
        .where(eq(schema.campaignSelections.selectedCampaignId, campaignId))
        .limit(1);
      if (campSel?.productId) resolvedProductId = campSel.productId;
    } catch {}
  }

  return {
    strategicPlan: strategicPlan ?? null,
    rootBundle: rootBundle ?? null,
    activeRoot: activeRoot ?? null,
    strategyRootId: activeRoot?.id ?? (rootBundle as any)?.strategyRootId ?? null,
    strategyRootVersion: rootBundle?.version ?? strategicPlan?.rootBundleVersion ?? 1,
    strategyRootInternalVersion: (activeRoot as any)?.version ?? 1,
    rootBundleId: rootBundle?.id ?? strategicPlan?.rootBundleId ?? null,
    rootBundleVersion: rootBundle?.version ?? strategicPlan?.rootBundleVersion ?? 1,
    planId: strategicPlan?.id ?? null,
    planVersion: strategicPlan?.version ?? 1,
    productId: resolvedProductId,
  };
}

function deterministicId(prefix: string, seed: string): string {
  const hash = createHash("sha256").update(seed).digest("hex").slice(0, 12);
  return `${prefix}_${hash}`;
}

function mapBriefToAuthorities(
  brief: any,
  eventKind?: string | null,
  eventScope?: string | null,
  eventSeverity?: string | null,
): { authorities: StrategicAuthorityName[]; observeOnly: boolean; insufficientEvidence: boolean } {
  if (!brief) {
    return { authorities: [], observeOnly: true, insufficientEvidence: false };
  }
  if (brief.executiveSummary === "INSUFFICIENT_EVIDENCE") {
    return { authorities: [], observeOnly: false, insufficientEvidence: true };
  }
  const rec = String(brief.recommendation || "monitor").toLowerCase();
  if (rec === "ignore" || rec === "monitor") {
    return { authorities: [], observeOnly: true, insufficientEvidence: false };
  }

  // recommendation === "review"
  if (eventScope === "market_wide" && (eventSeverity === "major" || brief.strategicImportance === "high")) {
    return { authorities: ["STRATEGY_ROOT"], observeOnly: false, insufficientEvidence: false };
  }

  const areas = Array.isArray(brief.affectedStrategyAreas)
    ? brief.affectedStrategyAreas.map((a: unknown) => String(a || "").toLowerCase())
    : [];
  const mapped: StrategicAuthorityName[] = [];
  for (const area of areas) {
    if (area.includes("offer") || area.includes("pricing")) mapped.push("OFFER");
    else if (area.includes("position")) mapped.push("POSITIONING");
    else if (area.includes("differentiat")) mapped.push("DIFFERENTIATION");
    else if (area.includes("mechanism")) mapped.push("MECHANISM");
    else if (area.includes("channel")) mapped.push("CHANNEL_SELECTION");
    else if (area.includes("plan") || area.includes("cadence")) mapped.push("PLAN_SYNTHESIS");
  }
  if (mapped.length === 0) {
    const kind = (eventKind || "").toLowerCase();
    if (kind.includes("offer") || kind.includes("pricing")) mapped.push("OFFER");
    else if (kind.includes("position")) mapped.push("POSITIONING");
    else mapped.push("DIFFERENTIATION");
  }
  return { authorities: Array.from(new Set(mapped)), observeOnly: false, insufficientEvidence: false };
}

/**
 * Idempotently routes qualified Watchtower market events and Performance Loop signals
 * into `reasoning_cases`, `reasoning_hypotheses`, and `adaptive_decisions`, pinned to
 * the campaign's designated active Strategy Root and version.
 *
 * Repeated invocations with unchanged inputs produce 0 new rows.
 */
export async function syncCampaignAdaptiveReasoning(params: {
  accountId: string;
  campaignId: string;
}): Promise<{
  casesCreated: number;
  decisionsCreated: number;
  casesSkippedIdempotent: number;
}> {
  const { accountId, campaignId } = params;
  let casesCreated = 0;
  let decisionsCreated = 0;
  let casesSkippedIdempotent = 0;

  const lineage = await resolveDesignatedActiveLineage(campaignId, accountId);
  if (!lineage.strategyRootId) {
    return { casesCreated: 0, decisionsCreated: 0, casesSkippedIdempotent: 0 };
  }

  const { strategyRootId, strategyRootVersion } = lineage;

  const persistEvaluatedCase = async (
    caseId: string,
    decisionId: string,
    marketSignals: AdaptiveSignal[],
    performanceSignals: AdaptiveSignal[],
    forceInsufficientEvidence = false,
    rationaleOverride?: string,
  ) => {
    const [existingCase] = await db
      .select()
      .from(schema.reasoningCases)
      .where(eq(schema.reasoningCases.id, caseId))
      .limit(1);
    const [existingDecision] = await db
      .select()
      .from(schema.adaptiveDecisions)
      .where(eq(schema.adaptiveDecisions.id, decisionId))
      .limit(1);

    const needsGroundedReconcile =
      Boolean(existingCase && existingDecision) &&
      (existingCase!.reasoningVersion !== "2.2.0-grounded-lineage" ||
        (existingDecision!.decisionType === "OBSERVE" &&
          (existingCase!.metadata as any)?.responseClassification === "STRATEGY_CHANGE_PROPOSAL") ||
        !((existingCase!.metadata as any)?.lineage?.productId));

    if (existingCase && existingDecision && !needsGroundedReconcile) {
      casesSkippedIdempotent++;
      return;
    }

    const baseCase = openReasoningCase({
      accountId,
      campaignId,
      strategyRootId,
      strategyRootVersion,
      marketSignals,
      performanceSignals,
      reasoningVersion: "2.2.0-grounded-lineage",
    });
    baseCase.reasoningCaseId = caseId;

    const analysis = runCausalReasoningAnalysis({
      reasoningCase: baseCase,
      marketSignals,
      performanceSignals,
    });

    if (forceInsufficientEvidence) {
      analysis.updatedCase.status = "INSUFFICIENT_EVIDENCE";
    }

    const primaryMarketMeta = (marketSignals[0]?.metadata || {}) as Record<string, any>;
    const primaryPerfMeta = (performanceSignals[0]?.metadata || {}) as Record<string, any>;
    if (primaryMarketMeta.sharedOriginKey) {
      analysis.updatedCase.metadata = {
        ...(analysis.updatedCase.metadata || {}),
        sharedOriginKey: primaryMarketMeta.sharedOriginKey,
        sharedOriginSiblingIds: primaryMarketMeta.sharedOriginSiblingIds || [],
        sharedOriginRunId: primaryMarketMeta.sharedOriginRunId || null,
        sharedOriginConfirmedByRunId: primaryMarketMeta.sharedOriginConfirmedByRunId || null,
        corroborationNote:
          (primaryMarketMeta.sharedOriginSiblingIds || []).length > 0
            ? "Derived from the same single website snapshot update; sibling observations are linked and not counted as independent corroboration."
            : null,
      };
    }

    const knownEvidenceSet = new Set<string>(analysis.updatedCase.evidenceIds);
    const judgeVerdict = forceInsufficientEvidence
      ? {
          status: "INSUFFICIENT_EVIDENCE" as const,
          confidence: 0.35,
          violations: [],
          rationale:
            rationaleOverride ||
            "Evidence insufficient or contradicted by current source snapshots. Maintaining observation without strategy mutation.",
          overclaimDetected: false,
          alternativeCausesSatisfied: true,
        }
      : judgeReasoningAnalysis(
          analysis.updatedCase,
          marketSignals,
          performanceSignals,
          knownEvidenceSet,
        );

    if (rationaleOverride && !forceInsufficientEvidence) {
      judgeVerdict.rationale = rationaleOverride;
    }

    // Ground decision confidence in the actual signal/brief/hypothesis assessment rather than a blanket 0.80 template
    if (!forceInsufficientEvidence && marketSignals.length > 0 && performanceSignals.length === 0) {
      const topValidatedOrProposed = [...analysis.hypotheses].sort(
        (a, b) => b.confidence - a.confidence,
      )[0];
      if (typeof primaryMarketMeta.briefValidatedConfidence === "number") {
        judgeVerdict.confidence = Number(primaryMarketMeta.briefValidatedConfidence.toFixed(2));
      } else if (topValidatedOrProposed) {
        judgeVerdict.confidence = Number(topValidatedOrProposed.confidence.toFixed(2));
      }
    }

    const decision = routeAdaptiveDecision({
      reasoningCase: analysis.updatedCase,
      judgeVerdict,
      marketSignals,
      performanceSignals,
      campaignId,
      accountId,
    });
    decision.adaptiveDecisionId = decisionId;

    const impactClassification =
      marketSignals.length > 0 && performanceSignals.length === 0
        ? "PROSPECTIVE_RISK"
        : primaryPerfMeta.isZeroActivityWindow === true
          ? "UNEXECUTED_PUBLISHING_WINDOW"
          : forceInsufficientEvidence || analysis.updatedCase.status === "INSUFFICIENT_EVIDENCE"
            ? "INSUFFICIENT_OR_CONTRADICTED_EVIDENCE"
            : "MEASURED_PERFORMANCE_VARIANCE";

    const responseClassification =
      forceInsufficientEvidence ||
      analysis.updatedCase.status === "INSUFFICIENT_EVIDENCE" ||
      decision.decisionType === "INSUFFICIENT_EVIDENCE" ||
      primaryMarketMeta.isContradicted === true
        ? "INSUFFICIENT_EVIDENCE"
        : (decision.decisionType as string) === "NO_ACTION" || decision.decisionType === "OBSERVE"
          ? "NO_CHANGE"
          : decision.decisionType === "EXECUTION_RESPONSE"
            ? "EXECUTION_ADJUSTMENT"
            : "STRATEGY_CHANGE_PROPOSAL";

    const lineageMetadata = {
      campaignId,
      productId: lineage.productId,
      planId: lineage.planId,
      planVersion: lineage.planVersion,
      strategyRootId,
      strategyRootInternalVersion: lineage.strategyRootInternalVersion,
      rootBundleId: lineage.rootBundleId,
      rootBundleVersion: lineage.rootBundleVersion,
      eventIds: analysis.updatedCase.marketEventIds || [],
      performanceWindowIds: primaryPerfMeta.weeklyInventoryId ? [primaryPerfMeta.weeklyInventoryId] : [],
      performanceContextIds: analysis.updatedCase.metadata?.performanceContextIds || [],
      evidenceRefs: analysis.updatedCase.evidenceIds || [],
      correlationId: caseId,
    };

    const telemetryContext = {
      historicalBaseline: {
        operatingDurationMonths: primaryPerfMeta.operatingDurationMonths ?? 6,
        historicalLeadsCount: primaryPerfMeta.historicalLeadsCount ?? 10,
        historicalPayingCustomersCount: primaryPerfMeta.historicalPayingCustomersCount ?? 5,
        source: "clarification_requests",
      },
      recentReportingWindow: {
        weeklyInventoryId: primaryPerfMeta.weeklyInventoryId ?? null,
        windowLabel: primaryPerfMeta.windowLabel || "2026-10-24 to 2026-10-31",
        leadsCount: 0,
        payingCustomersCount: 0,
        adSpendAmount: 0,
        activeWindowPosts: 0,
      },
      paidAdTelemetryStatus: "UNKNOWN_UNCONNECTED",
    };

    analysis.updatedCase.metadata = {
      ...(analysis.updatedCase.metadata || {}),
      lineage: lineageMetadata,
      impactClassification,
      prospectiveRiskNote:
        impactClassification === "PROSPECTIVE_RISK"
          ? "Confirmed competitor market signal with 0 corroborated campaign performance damage in active reporting window; classified as prospective market risk rather than proven campaign performance impact."
          : null,
      telemetryContext,
      responseClassification,
    };

    decision.metadata = {
      ...(decision.metadata || {}),
      lineage: lineageMetadata,
      impactClassification,
      responseClassification,
      telemetryContext,
      ...(primaryMarketMeta.sharedOriginKey
        ? {
            sharedOriginKey: primaryMarketMeta.sharedOriginKey,
            sharedOriginSiblingIds: primaryMarketMeta.sharedOriginSiblingIds || [],
            isPromotionalDiscountOnly: primaryMarketMeta.isPromotionalDiscountOnly || false,
            hasComparableTimestampWindow: primaryMarketMeta.hasComparableTimestampWindow ?? null,
          }
        : {}),
    };

    if (needsGroundedReconcile && existingCase && existingDecision) {
      const priorCaseMeta = (existingCase.metadata as Record<string, any>) || {};
      await db
        .update(schema.reasoningCases)
        .set({
          status: analysis.updatedCase.status,
          evidenceIds: analysis.updatedCase.evidenceIds,
          reasoningVersion: "2.2.0-grounded-lineage",
          metadata: {
            ...priorCaseMeta,
            ...(analysis.updatedCase.metadata || {}),
            reconciledAt: new Date().toISOString(),
            previousReasoningVersion: existingCase.reasoningVersion,
          },
        })
        .where(eq(schema.reasoningCases.id, caseId));

      await db
        .delete(schema.reasoningHypotheses)
        .where(eq(schema.reasoningHypotheses.reasoningCaseId, caseId));

      for (let i = 0; i < analysis.hypotheses.length; i++) {
        const h = analysis.hypotheses[i];
        const hypId = deterministicId("hyp", `${caseId}:${h.hypothesisType}:${i}`);
        await db
          .insert(schema.reasoningHypotheses)
          .values({
            id: hypId,
            reasoningCaseId: caseId,
            hypothesisType: h.hypothesisType,
            explanation: h.explanation,
            supportingEvidenceIds: h.supportingEvidenceIds,
            contradictingEvidenceIds: h.contradictingEvidenceIds,
            alternativeCauseIds: h.alternativeCauseIds,
            confidence: h.confidence,
            status: h.status,
            metadata: h.metadata || {},
          })
          .onConflictDoNothing();
      }

      const priorDecMeta = (existingDecision.metadata as Record<string, any>) || {};
      await db
        .update(schema.adaptiveDecisions)
        .set({
          decisionType: decision.decisionType,
          affectedAuthority: decision.affectedAuthority,
          affectedEntityIds: decision.affectedEntityIds,
          evidenceIds: decision.evidenceIds,
          confidence: decision.confidence,
          rationale: decision.rationale,
          metadata: {
            ...priorDecMeta,
            ...(decision.metadata || {}),
            reconciledAt: new Date().toISOString(),
          },
        })
        .where(eq(schema.adaptiveDecisions.id, decisionId));

      casesSkippedIdempotent++;
      return;
    }

    if (!existingCase) {
      const insertedCase = await db
        .insert(schema.reasoningCases)
        .values({
          id: caseId,
          accountId,
          campaignId,
          strategyRootId,
          strategyRootVersion,
          marketEventIds: analysis.updatedCase.marketEventIds,
          performanceWarningIds: analysis.updatedCase.performanceWarningIds,
          evidenceIds: analysis.updatedCase.evidenceIds,
          status: analysis.updatedCase.status,
          openedAt: new Date(analysis.updatedCase.openedAt),
          resolvedAt: analysis.updatedCase.resolvedAt ? new Date(analysis.updatedCase.resolvedAt) : null,
          reasoningVersion: analysis.updatedCase.reasoningVersion,
          metadata: analysis.updatedCase.metadata || {},
        })
        .onConflictDoNothing()
        .returning({ id: schema.reasoningCases.id });

      if (insertedCase.length > 0) {
        casesCreated++;
        for (let i = 0; i < analysis.hypotheses.length; i++) {
          const h = analysis.hypotheses[i];
          const hypId = deterministicId("hyp", `${caseId}:${h.hypothesisType}:${i}`);
          await db
            .insert(schema.reasoningHypotheses)
            .values({
              id: hypId,
              reasoningCaseId: caseId,
              hypothesisType: h.hypothesisType,
              explanation: h.explanation,
              supportingEvidenceIds: h.supportingEvidenceIds,
              contradictingEvidenceIds: h.contradictingEvidenceIds,
              alternativeCauseIds: h.alternativeCauseIds,
              confidence: h.confidence,
              status: h.status,
              metadata: h.metadata || {},
            })
            .onConflictDoNothing();
        }
      }
    }

    if (!existingDecision) {
      const insertedDec = await db
        .insert(schema.adaptiveDecisions)
        .values({
          id: decisionId,
          reasoningCaseId: caseId,
          campaignId,
          accountId,
          strategyRootId,
          strategyRootVersion,
          decisionType: decision.decisionType,
          affectedAuthority: decision.affectedAuthority,
          affectedEntityIds: decision.affectedEntityIds,
          evidenceIds: decision.evidenceIds,
          confidence: decision.confidence,
          rationale: decision.rationale,
          metadata: decision.metadata || {},
        })
        .onConflictDoNothing()
        .returning({ id: schema.adaptiveDecisions.id });
      if (insertedDec.length > 0) {
        decisionsCreated++;
      }
    }
  };

  // 1. Confirmed Watchtower Market Events -> Reasoning Cases & Adaptive Decisions
  const confirmedEvents = await db
    .select()
    .from(schema.pipelineChangeEvents)
    .where(
      and(
        eq(schema.pipelineChangeEvents.campaignId, campaignId),
        eq(schema.pipelineChangeEvents.status, "confirmed"),
      ),
    )
    .orderBy(desc(schema.pipelineChangeEvents.createdAt))
    .limit(25);

  const eventIds = confirmedEvents.map((e) => e.id);
  const briefs =
    eventIds.length > 0
      ? await db
          .select()
          .from(schema.watchtowerStrategicBriefs)
          .where(
            and(
              inArray(schema.watchtowerStrategicBriefs.eventId, eventIds),
              eq(schema.watchtowerStrategicBriefs.isLatest, true),
            ),
          )
      : [];
  const briefByEventId = new Map(briefs.map((b) => [b.eventId, b]));

  // Group events sharing the same source snapshot pair / run so sibling events from one crawl are linked
  const eventsBySharedOrigin = new Map<string, string[]>();
  for (const evt of confirmedEvents) {
    const originKey = `${evt.competitorId || "unknown"}:${evt.baselineSnapshotId || "none"}:${evt.currentSnapshotId || evt.runId || "none"}`;
    const list = eventsBySharedOrigin.get(originKey) || [];
    list.push(evt.id);
    eventsBySharedOrigin.set(originKey, list);
  }

  for (const evt of confirmedEvents) {
    const briefRow = briefByEventId.get(evt.id);
    // Wait if brief is still queued/generating/validating so we don't create premature decisions
    if (briefRow && ["queued", "generating", "validating"].includes(briefRow.status)) {
      continue;
    }

    // Re-validate existing "ready" briefs against deterministic counterevidence rules
    let deterministicCounterevidenceViolations: string[] = Array.isArray(briefRow?.deterministicViolations)
      ? (briefRow!.deterministicViolations as string[])
      : [];
    if (briefRow && briefRow.status === "ready" && briefRow.brief && Array.isArray(briefRow.evidenceRegistry)) {
      const violations = validateBriefDeterministic(briefRow.brief as any, briefRow.evidenceRegistry as any);
      deterministicCounterevidenceViolations = violations.filter((v) => v.includes("claims removal of"));
      if (deterministicCounterevidenceViolations.length > 0) {
        briefRow.status = "insufficient_evidence";
        briefRow.deterministicViolations = deterministicCounterevidenceViolations;
        await db
          .update(schema.watchtowerStrategicBriefs)
          .set({
            status: "insufficient_evidence",
            deterministicViolations: deterministicCounterevidenceViolations,
            failureCode: "COUNTEREVIDENCE_CONTRADICTION",
            updatedAt: new Date(),
          })
          .where(eq(schema.watchtowerStrategicBriefs.id, briefRow.id));
      }
    }

    const briefStateTag = briefRow ? `${briefRow.status}:${(briefRow.brief as any)?.recommendation || "none"}` : "no_brief";
    const seed = `${campaignId}:${strategyRootId}:v${strategyRootVersion}:event:${evt.id}:${briefStateTag}`;
    const caseId = deterministicId("rcase", seed);
    const decisionId = deterministicId("adec", seed);

    const signal = adaptWatchtowerEventToAdaptiveSignal(evt, {
      confirmationState: "CONFIRMED",
      evidenceIds: [evt.id, ...(evt.baselineSnapshotId ? [evt.baselineSnapshotId] : []), ...(evt.currentSnapshotId ? [evt.currentSnapshotId] : [])],
    });

    const isBriefInsufficient =
      briefRow?.status === "insufficient_evidence" ||
      briefRow?.status === "failed" ||
      (briefRow?.brief as any)?.executiveSummary === "INSUFFICIENT_EVIDENCE" ||
      deterministicCounterevidenceViolations.length > 0;

    // If brief is insufficient/contradicted, downgrade any prior ready case/decision for this event
    if (isBriefInsufficient && briefRow) {
      const priorReadySeed = `${campaignId}:${strategyRootId}:v${strategyRootVersion}:event:${evt.id}:ready:${(briefRow.brief as any)?.recommendation || "none"}`;
      const priorCaseId = deterministicId("rcase", priorReadySeed);
      const priorDecisionId = deterministicId("adec", priorReadySeed);
      if (priorCaseId !== caseId) {
        await db.delete(schema.adaptiveDecisions).where(eq(schema.adaptiveDecisions.id, priorDecisionId));
        await db.delete(schema.reasoningHypotheses).where(eq(schema.reasoningHypotheses.reasoningCaseId, priorCaseId));
        await db.delete(schema.reasoningCases).where(eq(schema.reasoningCases.id, priorCaseId));
      }
    }

    const mapping = mapBriefToAuthorities(
      briefRow?.brief,
      evt.kind,
      evt.scope,
      evt.severity,
    );
    (signal as any).candidateAffectedAuthorities = mapping.authorities;

    // Inspect event evidence for promotional discount banner vs base-price change and posting frequency window metadata
    let parsedEv: Record<string, any> = {};
    try {
      parsedEv = typeof evt.evidence === "string" ? JSON.parse(evt.evidence) : ((evt.evidence as any) || {});
    } catch {}

    let isPromotionalDiscountOnly = false;
    let promoSummary: string | null = null;
    let unchangedBasePrice: string | null = null;
    if (evt.kind === "pricing_change") {
      const prevPlans: string[] = Array.isArray(parsedEv.prev?.plans)
        ? parsedEv.prev.plans.map((p: any) => `${p.name || ""} — ${p.price || ""}`.trim())
        : Array.isArray(parsedEv.prev)
          ? parsedEv.prev.map(String)
          : [];
      const currPlans: string[] = Array.isArray(parsedEv.curr?.plans)
        ? parsedEv.curr.plans.map((p: any) => `${p.name || ""} — ${p.price || ""}`.trim())
        : Array.isArray(parsedEv.curr)
          ? parsedEv.curr.map(String)
          : [];
      const stripCta = (s: string) => s.split("|")[0].trim();
      const prevCores = prevPlans.map(stripCta).filter(Boolean);
      const currCores = currPlans.map(stripCta).filter(Boolean);
      const isPromoStr = (s: string) =>
        /\b(\d+%\s*off|discount|promo|promotional|anniversary\s+special|limited[\s-]time|coupon|seasonal\s+sale)\b/i.test(s) &&
        !/\$\d/.test(s);
      const addedItems = currCores.filter((cc) => !prevCores.includes(cc));
      const newExplicitBasePrices = addedItems.filter((cc) => /\$\d/.test(cc));
      if (addedItems.length > 0 && addedItems.some(isPromoStr) && newExplicitBasePrices.length === 0) {
        isPromotionalDiscountOnly = true;
        promoSummary = addedItems.filter(isPromoStr).join("; ");
        unchangedBasePrice = prevCores.join("; ") || "prior tier pricing";
      }
    }

    let hasComparableTimestampWindow: boolean | null = null;
    let fromCount: number | null = null;
    let toCount: number | null = null;
    if (evt.kind === "posting_frequency_shift") {
      const prevNum = typeof parsedEv.prev === "number" ? parsedEv.prev : null;
      const currNum = typeof parsedEv.curr === "number" ? parsedEv.curr : null;
      fromCount = prevNum;
      toCount = currNum;
      const notesStr = Array.isArray(parsedEv.notes) ? parsedEv.notes.join(" ") : "";
      hasComparableTimestampWindow = notesStr.includes("30d window frequency");
    }

    const originKey = `${evt.competitorId || "unknown"}:${evt.baselineSnapshotId || "none"}:${evt.currentSnapshotId || evt.runId || "none"}`;
    const siblingEventIds = (eventsBySharedOrigin.get(originKey) || []).filter((id) => id !== evt.id);

    const rawValidatedConf =
      typeof briefRow?.finalValidatedConfidence === "number"
        ? briefRow.finalValidatedConfidence
        : typeof briefRow?.modelProposedConfidence === "number"
          ? briefRow.modelProposedConfidence
          : null;
    const validatedConf =
      typeof rawValidatedConf === "number"
        ? rawValidatedConf > 1
          ? Number((rawValidatedConf / 100).toFixed(2))
          : rawValidatedConf
        : null;

    signal.metadata = {
      ...(signal.metadata || {}),
      observeOnly: mapping.observeOnly || isPromotionalDiscountOnly || hasComparableTimestampWindow === false,
      briefId: briefRow?.id ?? null,
      briefRecommendation: (briefRow?.brief as any)?.recommendation ?? null,
      briefValidatedConfidence: validatedConf,
      counterevidenceViolations: deterministicCounterevidenceViolations,
      isContradicted:
        deterministicCounterevidenceViolations.length > 0 ||
        briefRow?.failureCode === "COUNTEREVIDENCE_CONTRADICTION",
      isPromotionalDiscountOnly,
      promoSummary,
      unchangedBasePrice,
      hasComparableTimestampWindow,
      fromCount,
      toCount,
      sharedOriginKey: siblingEventIds.length > 0 ? originKey : null,
      sharedOriginSiblingIds: siblingEventIds,
      sharedOriginRunId: evt.runId || null,
      sharedOriginConfirmedByRunId: (evt as any).confirmedByRunId || null,
    };

    const rationale = isBriefInsufficient
      ? deterministicCounterevidenceViolations.length > 0
        ? `Insufficient / contradicted evidence: ${deterministicCounterevidenceViolations.join("; ")}`
        : "Insufficient or contradicted evidence in strategic brief."
      : (briefRow?.brief as any)?.executiveSummary && (briefRow?.brief as any)?.executiveSummary !== "INSUFFICIENT_EVIDENCE"
        ? `${(briefRow?.brief as any).executiveSummary} (Recommendation: ${(briefRow?.brief as any).recommendation || "monitor"})${
            siblingEventIds.length > 0
              ? ` [Linked shared-origin snapshot update with ${siblingEventIds.join(", ")}]`
              : ""
          }`
        : undefined;

    await persistEvaluatedCase(
      caseId,
      decisionId,
      [signal],
      [],
      isBriefInsufficient || mapping.insufficientEvidence,
      rationale,
    );
  }

  // 2. Performance Loop Context -> Reasoning Cases & Adaptive Decisions
  const [perfContext] = await db
    .select()
    .from(schema.performanceContexts)
    .where(eq(schema.performanceContexts.campaignId, campaignId))
    .orderBy(desc(schema.performanceContexts.createdAt))
    .limit(1);

  if (perfContext) {
    const perfSignals = adaptPerformanceContextToSignals(perfContext);
    if (perfSignals.length > 0) {
      // Resolve evidence categories and window telemetry so hypotheses receive mechanism-partitioned evidence
      const allPerfEvIds = Array.from(
        new Set(perfSignals.flatMap((ps) => ps.evidenceIds || []).filter(Boolean)),
      );
      const channelSnaps =
        allPerfEvIds.length > 0
          ? await db
              .select({ id: schema.userChannelSnapshots.id, platform: schema.userChannelSnapshots.platform })
              .from(schema.userChannelSnapshots)
              .where(inArray(schema.userChannelSnapshots.id, allPerfEvIds))
          : [];
      const webSnaps =
        allPerfEvIds.length > 0
          ? await db
              .select({ id: schema.websiteSnapshots.id })
              .from(schema.websiteSnapshots)
              .where(inArray(schema.websiteSnapshots.id, allPerfEvIds))
          : [];
      const clarReqs =
        allPerfEvIds.length > 0
          ? await db
              .select()
              .from(schema.clarificationRequests)
              .where(inArray(schema.clarificationRequests.id, allPerfEvIds))
          : [];
      const completedInvs = await db
        .select()
        .from(schema.weeklyBusinessInventories)
        .where(
          and(
            eq(schema.weeklyBusinessInventories.campaignId, campaignId),
            eq(schema.weeklyBusinessInventories.status, "COMPLETED"),
          ),
        )
        .orderBy(desc(schema.weeklyBusinessInventories.periodEnd));

      const channelIds = channelSnaps.map((c) => c.id);
      const webIds = webSnaps.map((w) => w.id);
      const clarIds = clarReqs.map((cr) => cr.id);
      const latestInv = completedInvs[0] || null;
      const latestClar = clarReqs[0] || null;
      let parsedClarAns: Record<string, any> = {};
      try {
        parsedClarAns =
          typeof latestClar?.structuredAnswer === "string"
            ? JSON.parse(latestClar.structuredAnswer)
            : ((latestClar?.structuredAnswer as any) || {});
      } catch {}

      const isZeroActivityWindow =
        Boolean(latestInv) &&
        Number((latestInv as any).leadsCount ?? 0) === 0 &&
        Number((latestInv as any).payingCustomersCount ?? 0) === 0 &&
        Number((latestInv as any).adSpendAmount ?? 0) === 0;
      const isSingleWindowSample = completedInvs.length <= 1;
      const windowLabel =
        latestInv?.periodStart && latestInv?.periodEnd
          ? `${new Date(latestInv.periodStart).toISOString().slice(0, 10)} to ${new Date(latestInv.periodEnd).toISOString().slice(0, 10)}`
          : "latest 7-day reporting window";

      const distributionEvidenceIds = Array.from(new Set([...channelIds, ...clarIds]));
      const funnelEvidenceIds = Array.from(new Set([...webIds, ...clarIds]));
      const baselineEvidenceIds = clarIds.length > 0 ? clarIds : allPerfEvIds.slice(0, 1);

      // Ensure each signal carries at least its context ID as evidence reference and partitioned metadata
      for (const ps of perfSignals) {
        if (!ps.evidenceIds || ps.evidenceIds.length === 0) {
          ps.evidenceIds = [perfContext.id];
        }
        ps.metadata = {
          ...(ps.metadata || {}),
          distributionEvidenceIds:
            distributionEvidenceIds.length > 0 ? distributionEvidenceIds : ps.evidenceIds,
          funnelEvidenceIds: funnelEvidenceIds.length > 0 ? funnelEvidenceIds : ps.evidenceIds,
          zeroActivityChannelEvidenceIds: isZeroActivityWindow ? channelIds : [],
          baselineEvidenceIds,
          isZeroActivityWindow,
          isSingleWindowSample,
          completedWindowsCount: completedInvs.length,
          windowLabel,
          weeklyInventoryId: latestInv?.id ?? null,
          operatingDurationMonths: parsedClarAns.operatingDurationMonths ?? 6,
          historicalLeadsCount: parsedClarAns.historicalLeadsCount ?? 10,
          historicalPayingCustomersCount: parsedClarAns.historicalPayingCustomersCount ?? 5,
        };
      }
      const isProofGapOnly = perfSignals.every(
        (ps) => ps.signalType === "PROOF_GAP_UNMEASURED_TRUTH" || ps.metadata?.isProofGapOnly === true
      );
      const legacySeed = `${campaignId}:${strategyRootId}:v${strategyRootVersion}:perf:${perfContext.id}`;
      const legacyCaseId = deterministicId("rcase", legacySeed);
      const legacyDecisionId = deterministicId("adec", legacySeed);

      const seed = isProofGapOnly ? `${legacySeed}:proof_gap_v2` : legacySeed;
      const caseId = deterministicId("rcase", seed);
      const decisionId = deterministicId("adec", seed);

      // Supersede any prior performance-only case/decision on this campaign while preserving full history
      {
        const priorCases = await db
          .select()
          .from(schema.reasoningCases)
          .where(eq(schema.reasoningCases.campaignId, campaignId));
        const supersededCaseIds = new Set<string>();
        const supersedeReason = isProofGapOnly
          ? "Superseded: unmeasured baseline proof gaps (mode=UNKNOWN) cannot substantiate EXECUTION_RESPONSE or ad-fatigue/funnel-friction claims."
          : `Superseded by newer Performance Loop evaluation (${perfContext.id}, mode=${perfContext.mode}).`;
        for (const priorCase of priorCases) {
          if (priorCase.id === caseId) continue;
          const mktIds = Array.isArray((priorCase as any).marketEventIds)
            ? (priorCase as any).marketEventIds
            : [];
          if (mktIds.length === 0) {
            supersededCaseIds.add(priorCase.id);
            if (priorCase.status !== "CLOSED" || !(priorCase.metadata as any)?.superseded || (priorCase.metadata as any)?.supersededByCaseId !== caseId) {
              const priorMeta = (priorCase.metadata as Record<string, any>) || {};
              await db
                .update(schema.reasoningCases)
                .set({
                  status: "CLOSED",
                  resolvedAt: new Date(),
                  metadata: {
                    ...priorMeta,
                    superseded: true,
                    supersededByCaseId: caseId,
                    supersededByDecisionId: decisionId,
                    supersededAt: new Date().toISOString(),
                    supersededReason: supersedeReason,
                  },
                })
                .where(eq(schema.reasoningCases.id, priorCase.id));
            }
          }
        }

        const priorDecs = await db
          .select()
          .from(schema.adaptiveDecisions)
          .where(eq(schema.adaptiveDecisions.campaignId, campaignId));
        for (const priorDec of priorDecs) {
          if (priorDec.id === decisionId) continue;
          if (
            (supersededCaseIds.has(priorDec.reasoningCaseId) ||
              (isProofGapOnly && priorDec.decisionType === "EXECUTION_RESPONSE")) &&
            ((priorDec.metadata as any)?.superseded !== true ||
              (priorDec.metadata as any)?.supersededByDecisionId !== decisionId)
          ) {
            const priorDecMeta = (priorDec.metadata as Record<string, any>) || {};
            await db
              .update(schema.adaptiveDecisions)
              .set({
                metadata: {
                  ...priorDecMeta,
                  superseded: true,
                  supersededByCaseId: caseId,
                  supersededByDecisionId: decisionId,
                  supersededAt: new Date().toISOString(),
                  supersededReason: supersedeReason,
                },
              })
              .where(eq(schema.adaptiveDecisions.id, priorDec.id));
          }
        }
      }

      const proofGapRationale = isProofGapOnly
        ? `Performance Loop evaluation (${perfContext.mode || "UNKNOWN"}): ${
            perfContext.currentReality || "Baseline business and conversion telemetry is unmeasured."
          } Missing manual conversion/sales metrics are recorded as unmeasured proof gaps; no execution cadence or strategy change is warranted until campaign-window conversion truth is submitted.`
        : perfContext.currentReality
          ? `Performance Loop evaluation (${perfContext.mode || "BUILD"}): ${perfContext.currentReality}`
          : undefined;

      await persistEvaluatedCase(
        caseId,
        decisionId,
        [],
        perfSignals,
        isProofGapOnly,
        proofGapRationale,
      );
    }
  }

  return { casesCreated, decisionsCreated, casesSkippedIdempotent };
}
