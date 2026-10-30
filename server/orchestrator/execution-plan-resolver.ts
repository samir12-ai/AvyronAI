/**
 * Canonical Execution Plan Resolver
 *
 * Implements deterministic execution authority across Avyron:
 * 1. Intent Gate: 'execution' | 'draft_review' | 'historical_inspection' | 'resume'
 * 2. Zero Silent Fallbacks: Paused or stopped designated plans halt cleanly with an explicit reason.
 * 3. Atomic Designation: At most one plan has is_designated_active = true per (accountId, campaignId).
 * 4. Draft Quarantine: Generating a new draft never displaces the designated active execution plan.
 */

import { db } from "../db";
import * as schema from "@shared/schema";
import { and, eq, desc } from "drizzle-orm";

export type RunResolutionIntent = "execution" | "draft_review" | "historical_inspection" | "resume";

export interface ExecutionPlanResolutionResult {
  canExecute: boolean;
  intent: RunResolutionIntent;
  plan: typeof schema.strategicPlans.$inferSelect | null;
  approvedBaseline?: typeof schema.strategicPlans.$inferSelect | null;
  reason?: string;
  planId?: string;
  isDesignatedActive?: boolean;
}

export async function resolveExecutionPlan(args: {
  accountId: string;
  campaignId: string;
  intent: RunResolutionIntent;
  specificPlanId?: string;
}): Promise<ExecutionPlanResolutionResult> {
  const { accountId, campaignId, intent, specificPlanId } = args;

  // ── INTENT 1: EXECUTION ──
  // Operational engines (What To Do Today, Content Calendar, Publish Worker, Autonomous Worker)
  if (intent === "execution") {
    // Exclusively query the designated active plan
    const [designated] = await db
      .select()
      .from(schema.strategicPlans)
      .where(
        and(
          eq(schema.strategicPlans.accountId, accountId),
          eq(schema.strategicPlans.campaignId, campaignId),
          eq(schema.strategicPlans.isDesignatedActive, true)
        )
      )
      .limit(1);

    if (!designated) {
      // Check if there is an approved plan awaiting designation
      const [approvedCandidate] = await db
        .select()
        .from(schema.strategicPlans)
        .where(
          and(
            eq(schema.strategicPlans.accountId, accountId),
            eq(schema.strategicPlans.campaignId, campaignId),
            eq(schema.strategicPlans.status, "APPROVED")
          )
        )
        .limit(1);

      return {
        canExecute: false,
        intent: "execution",
        plan: null,
        planId: approvedCandidate?.id,
        reason: approvedCandidate
          ? "APPROVED_PLAN_NOT_DESIGNATED_ACTIVE"
          : "NO_APPROVED_PLAN_EXISTS",
      };
    }

    if (designated.status !== "APPROVED") {
      return {
        canExecute: false,
        intent: "execution",
        plan: designated,
        planId: designated.id,
        reason: "DESIGNATED_PLAN_NOT_APPROVED",
      };
    }

    if (designated.emergencyStopped || designated.executionStatus === "STOPPED") {
      return {
        canExecute: false,
        intent: "execution",
        plan: designated,
        planId: designated.id,
        reason: "PLAN_EMERGENCY_STOP",
      };
    }

    if (designated.executionStatus === "PAUSED") {
      return {
        canExecute: false,
        intent: "execution",
        plan: designated,
        planId: designated.id,
        reason: "PLAN_EXECUTION_PAUSED",
      };
    }

    // Eligible for operational execution
    return {
      canExecute: true,
      intent: "execution",
      plan: designated,
      planId: designated.id,
      isDesignatedActive: true,
    };
  }

  // ── INTENT 2: DRAFT REVIEW ──
  // User review UI and plan comparison
  if (intent === "draft_review") {
    // 1. Fetch current designated baseline (if any)
    const [designatedBaseline] = await db
      .select()
      .from(schema.strategicPlans)
      .where(
        and(
          eq(schema.strategicPlans.accountId, accountId),
          eq(schema.strategicPlans.campaignId, campaignId),
          eq(schema.strategicPlans.isDesignatedActive, true)
        )
      )
      .limit(1);

    // 2. Fetch candidate draft
    let candidateDraft: typeof schema.strategicPlans.$inferSelect | undefined;
    if (specificPlanId) {
      const [bySpecificId] = await db
        .select()
        .from(schema.strategicPlans)
        .where(
          and(
            eq(schema.strategicPlans.id, specificPlanId),
            eq(schema.strategicPlans.accountId, accountId),
            eq(schema.strategicPlans.campaignId, campaignId)
          )
        )
        .limit(1);
      candidateDraft = bySpecificId;
    } else {
      // Find latest draft plan
      const [latestDraft] = await db
        .select()
        .from(schema.strategicPlans)
        .where(
          and(
            eq(schema.strategicPlans.accountId, accountId),
            eq(schema.strategicPlans.campaignId, campaignId),
            eq(schema.strategicPlans.status, "DRAFT")
          )
        )
        .orderBy(desc(schema.strategicPlans.createdAt))
        .limit(1);
      candidateDraft = latestDraft;
    }

    return {
      canExecute: false,
      intent: "draft_review",
      plan: candidateDraft || null,
      approvedBaseline: designatedBaseline || null,
      planId: candidateDraft?.id,
      reason: candidateDraft ? undefined : "NO_DRAFT_PLAN_FOUND",
    };
  }

  // ── INTENT 3: HISTORICAL INSPECTION ──
  if (intent === "historical_inspection") {
    if (!specificPlanId) {
      return {
        canExecute: false,
        intent: "historical_inspection",
        plan: null,
        reason: "SPECIFIC_PLAN_ID_REQUIRED",
      };
    }

    const [historical] = await db
      .select()
      .from(schema.strategicPlans)
      .where(
        and(
          eq(schema.strategicPlans.id, specificPlanId),
          eq(schema.strategicPlans.accountId, accountId),
          eq(schema.strategicPlans.campaignId, campaignId)
        )
      )
      .limit(1);

    return {
      canExecute: false,
      intent: "historical_inspection",
      plan: historical || null,
      planId: specificPlanId,
      reason: historical ? undefined : "PLAN_NOT_FOUND",
    };
  }

  // ── INTENT 4: RESUME ──
  if (intent === "resume") {
    // Resolve plan by specific ID or active plan
    const targetId = specificPlanId;
    if (!targetId) {
      return {
        canExecute: false,
        intent: "resume",
        plan: null,
        reason: "RESUME_PLAN_ID_REQUIRED",
      };
    }

    const [plan] = await db
      .select()
      .from(schema.strategicPlans)
      .where(
        and(
          eq(schema.strategicPlans.id, targetId),
          eq(schema.strategicPlans.accountId, accountId),
          eq(schema.strategicPlans.campaignId, campaignId)
        )
      )
      .limit(1);

    return {
      canExecute: plan?.status === "APPROVED" && plan?.executionStatus === "ACTIVE",
      intent: "resume",
      plan: plan || null,
      planId: targetId,
      reason: plan ? undefined : "RESUME_PLAN_NOT_FOUND",
    };
  }

  return {
    canExecute: false,
    intent,
    plan: null,
    reason: `UNKNOWN_INTENT: ${intent}`,
  };
}

/**
 * Concurrency-safe atomic transaction to designate an approved plan as the active execution plan.
 */
export async function designateActiveExecutionPlan(args: {
  accountId: string;
  campaignId: string;
  planId: string;
  reason?: string;
}): Promise<{ success: boolean; planId: string; error?: string }> {
  const { accountId, campaignId, planId, reason } = args;

  // 1. Verify target plan exists, belongs to tenant, and is APPROVED
  const [targetPlan] = await db
    .select()
    .from(schema.strategicPlans)
    .where(
      and(
        eq(schema.strategicPlans.id, planId),
        eq(schema.strategicPlans.accountId, accountId),
        eq(schema.strategicPlans.campaignId, campaignId)
      )
    )
    .limit(1);

  if (!targetPlan) {
    return { success: false, planId, error: "PLAN_NOT_FOUND" };
  }

  if (targetPlan.status !== "APPROVED") {
    return { success: false, planId, error: "CANNOT_DESIGNATE_UNAPPROVED_PLAN" };
  }

  // 2. Perform atomic switch in a transaction
  await db.transaction(async (tx) => {
    // Supersede any previously designated plan for this campaign
    await tx
      .update(schema.strategicPlans)
      .set({
        isDesignatedActive: false,
        status: "SUPERSEDED",
        executionStatus: "SUPERSEDED",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.strategicPlans.accountId, accountId),
          eq(schema.strategicPlans.campaignId, campaignId),
          eq(schema.strategicPlans.isDesignatedActive, true)
        )
      );

    // Designate the target plan as active
    await tx
      .update(schema.strategicPlans)
      .set({
        isDesignatedActive: true,
        status: "APPROVED",
        executionStatus: "ACTIVE",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.strategicPlans.id, planId),
          eq(schema.strategicPlans.accountId, accountId),
          eq(schema.strategicPlans.campaignId, campaignId)
        )
      );

    // Align strategy_roots and root_bundles
    let resolvedRootIdFromBundle: string | null = null;
    try {
      const parsedPlan =
        typeof targetPlan.planJson === "string"
          ? JSON.parse(targetPlan.planJson)
          : targetPlan.planJson;
      resolvedRootIdFromBundle =
        parsedPlan?.strategyRootId ||
        parsedPlan?.rootId ||
        parsedPlan?.strategyRoot?.id ||
        null;
    } catch {}

    if (targetPlan.rootBundleId) {
      const [bundleRow] = await tx
        .select()
        .from(schema.rootBundles)
        .where(
          and(
            eq(schema.rootBundles.id, targetPlan.rootBundleId),
            eq(schema.rootBundles.accountId, accountId),
            eq(schema.rootBundles.campaignId, campaignId)
          )
        )
        .limit(1);
      if (!resolvedRootIdFromBundle && bundleRow?.sourceSnapshot) {
        try {
          const parsedSnap =
            typeof bundleRow.sourceSnapshot === "string"
              ? JSON.parse(bundleRow.sourceSnapshot)
              : bundleRow.sourceSnapshot;
          resolvedRootIdFromBundle =
            parsedSnap?.strategyRootId || parsedSnap?.rootId || null;
        } catch {}
      }

      await tx
        .update(schema.rootBundles)
        .set({ status: "stale", updatedAt: new Date() })
        .where(
          and(
            eq(schema.rootBundles.accountId, accountId),
            eq(schema.rootBundles.campaignId, campaignId)
          )
        );
      await tx
        .update(schema.rootBundles)
        .set({ status: "active", updatedAt: new Date() })
        .where(
          and(
            eq(schema.rootBundles.id, targetPlan.rootBundleId),
            eq(schema.rootBundles.accountId, accountId),
            eq(schema.rootBundles.campaignId, campaignId)
          )
        );
    }

    const rootRows = await tx
      .select({
        id: schema.strategyRoots.id,
        runId: schema.strategyRoots.runId,
        status: schema.strategyRoots.status,
      })
      .from(schema.strategyRoots)
      .where(
        and(
          eq(schema.strategyRoots.accountId, accountId),
          eq(schema.strategyRoots.campaignId, campaignId)
        )
      )
      .orderBy(desc(schema.strategyRoots.createdAt));

    const matchingRoot =
      (resolvedRootIdFromBundle &&
        rootRows.find((r) => r.id === resolvedRootIdFromBundle)) ||
      (targetPlan.jobId &&
        rootRows.find((r) => r.runId === targetPlan.jobId)) ||
      rootRows.find((r) => r.status === "ACTIVE") ||
      rootRows[0];

    if (matchingRoot) {
      await tx
        .update(schema.strategyRoots)
        .set({ status: "SUPERSEDED" })
        .where(
          and(
            eq(schema.strategyRoots.accountId, accountId),
            eq(schema.strategyRoots.campaignId, campaignId)
          )
        );
      await tx
        .update(schema.strategyRoots)
        .set({ status: "ACTIVE" })
        .where(eq(schema.strategyRoots.id, matchingRoot.id));
    }

    // Prevent old pending/draft execution tasks from previous plans from appearing as current instructions
    const allCampaignTasks = await tx
      .select({ id: schema.executionTasks.id, planId: schema.executionTasks.planId, status: schema.executionTasks.status })
      .from(schema.executionTasks)
      .where(
        and(
          eq(schema.executionTasks.accountId, accountId),
          eq(schema.executionTasks.campaignId, campaignId)
        )
      );
    for (const t of allCampaignTasks) {
      if (t.planId !== planId && (t.status === "pending" || t.status === "DRAFT" || t.status === "ready")) {
        await tx
          .update(schema.executionTasks)
          .set({ status: "superseded", updatedAt: new Date() })
          .where(eq(schema.executionTasks.id, t.id));
      }
    }
  });

  console.log(
    `[ExecutionPlanResolver] PLAN_DESIGNATED_ACTIVE | campaign=${campaignId} | planId=${planId} | jobId=${targetPlan.jobId} | rootBundleId=${targetPlan.rootBundleId} | reason=${reason || "manual_approval"}`
  );

  return { success: true, planId };
}

export type PlanContextResolutionMode =
  | "APPROVED_ACTIVE"
  | "CANDIDATE_DRAFT"
  | "HISTORICAL_VERSION"
  | "LATEST_VIEWABLE";

export interface ResolvedPlanContext {
  accountId: string;
  campaignId: string;
  mode: PlanContextResolutionMode;
  selectedPlan: typeof schema.strategicPlans.$inferSelect | null;
  designatedActivePlan: typeof schema.strategicPlans.$inferSelect | null;
  candidateDraftPlan: typeof schema.strategicPlans.$inferSelect | null;
  strategyRoot: typeof schema.strategyRoots.$inferSelect | null;
  rootBundle: typeof schema.rootBundles.$inferSelect | null;
  jobId: string | null;
  planId: string | null;
  strategyRootId: string | null;
  rootBundleId: string | null;
  isDraftPreview: boolean;
  isDesignatedActive: boolean;
  isHistoricalOnly: boolean;
  snapshotIds: {
    audienceSnapshotId: string | null;
    positioningSnapshotId: string | null;
    differentiationSnapshotId: string | null;
    mechanismSnapshotId: string | null;
    offerSnapshotId: string | null;
  };
}

/**
 * Shared Plan-Context Resolver used by Strategy APIs, Audience/Positioning views,
 * Plan details, and Budget/Channel routes so all tabs resolve one consistent
 * (planId, jobId, strategyRootId, rootBundleId, snapshotIds) tuple.
 */
export async function resolvePlanContext(args: {
  campaignId: string;
  accountId: string;
  specificPlanId?: string | null;
  specificRunId?: string | null;
  mode?: PlanContextResolutionMode;
}): Promise<ResolvedPlanContext> {
  const { campaignId, accountId, specificPlanId, specificRunId, mode = "LATEST_VIEWABLE" } = args;

  const accountWhere = (table: any) =>
    accountId && accountId !== "default"
      ? and(eq(table.campaignId, campaignId), eq(table.accountId, accountId))
      : eq(table.campaignId, campaignId);

  // 1. Designated active approved plan (holds execution authority)
  const [designatedRow] = await db
    .select()
    .from(schema.strategicPlans)
    .where(
      and(
        accountWhere(schema.strategicPlans),
        eq(schema.strategicPlans.isDesignatedActive, true),
        eq(schema.strategicPlans.status, "APPROVED")
      )
    )
    .limit(1);

  const [latestApprovedRow] = designatedRow
    ? [designatedRow]
    : await db
        .select()
        .from(schema.strategicPlans)
        .where(and(accountWhere(schema.strategicPlans), eq(schema.strategicPlans.status, "APPROVED")))
        .orderBy(desc(schema.strategicPlans.updatedAt))
        .limit(1);

  const designatedActivePlan = designatedRow || latestApprovedRow || null;

  // 2. Latest candidate draft plan
  const [candidateDraftRow] = await db
    .select()
    .from(schema.strategicPlans)
    .where(and(accountWhere(schema.strategicPlans), eq(schema.strategicPlans.status, "DRAFT")))
    .orderBy(desc(schema.strategicPlans.createdAt))
    .limit(1);

  const candidateDraftPlan = candidateDraftRow || null;

  // 3. Determine selectedPlan deterministically
  let selectedPlan: typeof schema.strategicPlans.$inferSelect | null = null;
  let effectiveMode: PlanContextResolutionMode = mode;

  if (specificPlanId) {
    const [byId] = await db
      .select()
      .from(schema.strategicPlans)
      .where(and(accountWhere(schema.strategicPlans), eq(schema.strategicPlans.id, specificPlanId)))
      .limit(1);
    selectedPlan = byId || null;
    if (selectedPlan) {
      if (designatedActivePlan && selectedPlan.id === designatedActivePlan.id) {
        effectiveMode = "APPROVED_ACTIVE";
      } else if (candidateDraftPlan && selectedPlan.id === candidateDraftPlan.id) {
        effectiveMode = "CANDIDATE_DRAFT";
      } else {
        effectiveMode = "HISTORICAL_VERSION";
      }
    }
  } else if (specificRunId) {
    const [byRun] = await db
      .select()
      .from(schema.strategicPlans)
      .where(and(accountWhere(schema.strategicPlans), eq(schema.strategicPlans.jobId, specificRunId)))
      .orderBy(desc(schema.strategicPlans.createdAt))
      .limit(1);
    selectedPlan = byRun || null;
    if (selectedPlan) {
      effectiveMode =
        designatedActivePlan && selectedPlan.id === designatedActivePlan.id
          ? "APPROVED_ACTIVE"
          : candidateDraftPlan && selectedPlan.id === candidateDraftPlan.id
          ? "CANDIDATE_DRAFT"
          : "HISTORICAL_VERSION";
    }
  } else if (mode === "APPROVED_ACTIVE") {
    selectedPlan = designatedActivePlan;
  } else if (mode === "CANDIDATE_DRAFT") {
    selectedPlan = candidateDraftPlan;
  } else {
    // LATEST_VIEWABLE: if a newer candidate draft exists, surface it as a draft preview
    // while retaining designatedActivePlan as the explicit approved baseline.
    const isDraftNewer = Boolean(
      candidateDraftPlan &&
        (!designatedActivePlan ||
          (candidateDraftPlan.createdAt &&
            designatedActivePlan.createdAt &&
            candidateDraftPlan.createdAt.getTime() > designatedActivePlan.createdAt.getTime()))
    );
    selectedPlan = isDraftNewer ? candidateDraftPlan : designatedActivePlan || candidateDraftPlan || null;
    effectiveMode =
      selectedPlan && candidateDraftPlan && selectedPlan.id === candidateDraftPlan.id
        ? "CANDIDATE_DRAFT"
        : selectedPlan && designatedActivePlan && selectedPlan.id === designatedActivePlan.id
        ? "APPROVED_ACTIVE"
        : mode;
  }

  // 4. Resolve Root Bundle and Strategy Root strictly aligned with selectedPlan
  let rootBundle: typeof schema.rootBundles.$inferSelect | null = null;
  let strategyRoot: typeof schema.strategyRoots.$inferSelect | null = null;

  if (selectedPlan?.rootBundleId) {
    const [bundle] = await db
      .select()
      .from(schema.rootBundles)
      .where(and(accountWhere(schema.rootBundles), eq(schema.rootBundles.id, selectedPlan.rootBundleId)))
      .limit(1);
    rootBundle = bundle || null;
  }

  let resolvedRootIdFromPlanOrBundle: string | null = null;
  let planSnapshotIds: Record<string, string | null | undefined> = {};
  if (selectedPlan?.planJson) {
    try {
      const parsedPlan =
        typeof selectedPlan.planJson === "string"
          ? JSON.parse(selectedPlan.planJson)
          : selectedPlan.planJson;
      resolvedRootIdFromPlanOrBundle =
        parsedPlan?.strategyRootId ||
        parsedPlan?.rootId ||
        parsedPlan?.strategyRoot?.id ||
        parsedPlan?.governance?.strategyRoot?.rootId ||
        null;
      if (parsedPlan?._provenance?.reusedSnapshotIds && typeof parsedPlan._provenance.reusedSnapshotIds === "object") {
        planSnapshotIds = { ...parsedPlan._provenance.reusedSnapshotIds };
      }
      if (parsedPlan?._provenance?.selectedSnapshotIds && typeof parsedPlan._provenance.selectedSnapshotIds === "object") {
        planSnapshotIds = { ...planSnapshotIds, ...parsedPlan._provenance.selectedSnapshotIds };
      }
    } catch {}
  }
  if (rootBundle?.sourceSnapshot) {
    try {
      const parsedSnap =
        typeof rootBundle.sourceSnapshot === "string"
          ? JSON.parse(rootBundle.sourceSnapshot)
          : rootBundle.sourceSnapshot;
      if (!resolvedRootIdFromPlanOrBundle) {
        resolvedRootIdFromPlanOrBundle =
          parsedSnap?.strategyRootId || parsedSnap?.rootId || null;
      }
      if (parsedSnap?.selectedSnapshotIds && typeof parsedSnap.selectedSnapshotIds === "object") {
        planSnapshotIds = { ...parsedSnap.selectedSnapshotIds, ...planSnapshotIds };
      }
    } catch {}
  }

  if (resolvedRootIdFromPlanOrBundle) {
    const [rootByBundle] = await db
      .select()
      .from(schema.strategyRoots)
      .where(and(accountWhere(schema.strategyRoots), eq(schema.strategyRoots.id, resolvedRootIdFromPlanOrBundle)))
      .limit(1);
    strategyRoot = rootByBundle || null;
  }

  const targetRunId = selectedPlan?.jobId || specificRunId || null;
  if (!strategyRoot && targetRunId) {
    const [rootByRun] = await db
      .select()
      .from(schema.strategyRoots)
      .where(and(accountWhere(schema.strategyRoots), eq(schema.strategyRoots.runId, targetRunId)))
      .orderBy(desc(schema.strategyRoots.createdAt))
      .limit(1);
    strategyRoot = rootByRun || null;
  }

  let isHistoricalOnly = effectiveMode === "HISTORICAL_VERSION";
  if (!strategyRoot) {
    const rootRows = await db
      .select()
      .from(schema.strategyRoots)
      .where(accountWhere(schema.strategyRoots))
      .orderBy(desc(schema.strategyRoots.createdAt))
      .limit(10);
    strategyRoot = rootRows.find((r) => r.status === "ACTIVE") || rootRows[0] || null;
    if (strategyRoot && strategyRoot.status !== "ACTIVE" && !selectedPlan) {
      isHistoricalOnly = true;
    }
  }

  if (!rootBundle && strategyRoot?.id) {
    const [bundleByRoot] = await db
      .select()
      .from(schema.rootBundles)
      .where(accountWhere(schema.rootBundles))
      .orderBy(desc(schema.rootBundles.createdAt))
      .limit(1);
    rootBundle = bundleByRoot || null;
  }

  const isDraftPreview = Boolean(selectedPlan && selectedPlan.status === "DRAFT");
  const isDesignatedActive = Boolean(
    selectedPlan &&
      ((designatedActivePlan && selectedPlan.id === designatedActivePlan.id) || selectedPlan.isDesignatedActive)
  );

  return {
    accountId,
    campaignId,
    mode: effectiveMode,
    selectedPlan,
    designatedActivePlan,
    candidateDraftPlan,
    strategyRoot,
    rootBundle,
    jobId: selectedPlan?.jobId || strategyRoot?.runId || specificRunId || null,
    planId: selectedPlan?.id || null,
    strategyRootId: strategyRoot?.id || null,
    rootBundleId: rootBundle?.id || selectedPlan?.rootBundleId || null,
    isDraftPreview,
    isDesignatedActive,
    isHistoricalOnly,
    snapshotIds: {
      miSnapshotId: strategyRoot?.miSnapshotId || planSnapshotIds.market_intelligence || null,
      audienceSnapshotId: strategyRoot?.audienceSnapshotId || planSnapshotIds.audience || null,
      positioningSnapshotId: strategyRoot?.positioningSnapshotId || planSnapshotIds.positioning || null,
      differentiationSnapshotId: strategyRoot?.differentiationSnapshotId || planSnapshotIds.differentiation || null,
      mechanismSnapshotId: strategyRoot?.mechanismSnapshotId || planSnapshotIds.mechanism || null,
      offerSnapshotId: strategyRoot?.offerSnapshotId || planSnapshotIds.offer || null,
      awarenessSnapshotId: planSnapshotIds.awareness || null,
      funnelSnapshotId: planSnapshotIds.funnel || null,
      persuasionSnapshotId: planSnapshotIds.persuasion || null,
    },
  };
}

