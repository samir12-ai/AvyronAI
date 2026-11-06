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

export type RunResolutionIntent = "execution" | "draft_review" | "historical_inspection" | "resume" | "read";

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

    const todayDateStr = new Date().toISOString().split("T")[0];

    // Supersede current/future draft/pending calendar entries from superseded plans while preserving published/completed/historical items
    const allCalendarEntries = await tx
      .select({
        id: schema.calendarEntries.id,
        planId: schema.calendarEntries.planId,
        status: schema.calendarEntries.status,
        scheduledDate: schema.calendarEntries.scheduledDate,
      })
      .from(schema.calendarEntries)
      .where(eq(schema.calendarEntries.campaignId, campaignId));
    for (const ce of allCalendarEntries) {
      const ceDateStr = ce.scheduledDate ? new Date(ce.scheduledDate).toISOString().split("T")[0] : todayDateStr;
      if (
        ce.planId !== planId &&
        ceDateStr >= todayDateStr &&
        (ce.status === "DRAFT" || ce.status === "PENDING" || ce.status === "PLANNED")
      ) {
        await tx
          .update(schema.calendarEntries)
          .set({ status: "SUPERSEDED", updatedAt: new Date() })
          .where(eq(schema.calendarEntries.id, ce.id));
      }
    }

    // Supersede non-user-edited draft studio items from superseded plans while preserving published/completed/user-edited items
    const allStudioItems = await tx
      .select()
      .from(schema.studioItems)
      .where(eq(schema.studioItems.campaignId, campaignId));
    for (const si of allStudioItems) {
      if (si.planId !== planId && !(si as any).userEdited && (si.status === "DRAFT" || si.status === "PENDING")) {
        await tx
          .update(schema.studioItems)
          .set({ status: "SUPERSEDED", updatedAt: new Date() })
          .where(eq(schema.studioItems.id, si.id));
      }
    }

    // Supersede current/future active execution_days and non-completed daily_execution_tasks from superseded plans
    // Historical execution_days (businessDate < todayDateStr) are preserved intact with their original lineage.
    const allExecDays = await tx
      .select({
        id: schema.executionDays.id,
        strategicPlanId: schema.executionDays.strategicPlanId,
        status: schema.executionDays.status,
        businessDate: schema.executionDays.businessDate,
      })
      .from(schema.executionDays)
      .where(eq(schema.executionDays.campaignId, campaignId));
    for (const ed of allExecDays) {
      if (
        ed.strategicPlanId !== planId &&
        ed.businessDate >= todayDateStr &&
        (ed.status === "ACTIVE" || ed.status === "PLANNED")
      ) {
        await tx
          .update(schema.executionDays)
          .set({ status: "SUPERSEDED", updatedAt: new Date() })
          .where(eq(schema.executionDays.id, ed.id));
        const dayTasks = await tx
          .select({ id: schema.dailyExecutionTasks.id, status: schema.dailyExecutionTasks.status })
          .from(schema.dailyExecutionTasks)
          .where(eq(schema.dailyExecutionTasks.executionDayId, ed.id));
        for (const dt of dayTasks) {
          if (
            dt.status !== "DONE" &&
            dt.status !== "COMPLETED" &&
            dt.status !== "SKIPPED" &&
            dt.status !== "PUBLISHED"
          ) {
            await tx
              .update(schema.dailyExecutionTasks)
              .set({ status: "STALE", updatedAt: new Date() })
              .where(eq(schema.dailyExecutionTasks.id, dt.id));
          }
        }
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
  | "LATEST_VIEWABLE"
  | "SPECIFIC_PLAN";

export interface ResolvedPlanContext {
  accountId: string;
  businessId?: string | null;
  productId?: string | null;
  offeringId?: string | null;
  campaignId: string;
  mode: PlanContextResolutionMode;
  selectedPlan: typeof schema.strategicPlans.$inferSelect | null;
  designatedActivePlan: typeof schema.strategicPlans.$inferSelect | null;
  candidateDraftPlan: typeof schema.strategicPlans.$inferSelect | null;
  strategyRoot: typeof schema.strategyRoots.$inferSelect | null;
  rootBundle: typeof schema.rootBundles.$inferSelect | null;
  jobId: string | null;
  planId: string | null;
  planVersion?: number | null;
  strategyRootId: string | null;
  strategyRootVersion?: number | null;
  rootBundleId: string | null;
  rootBundleVersion?: number | null;
  isDraftPreview: boolean;
  isDesignatedActive: boolean;
  isHistoricalOnly: boolean;
  snapshotIds: {
    businessUnderstandingSnapshotId?: string | null;
    miSnapshotId?: string | null;
    audienceSnapshotId: string | null;
    positioningSnapshotId: string | null;
    differentiationSnapshotId: string | null;
    mechanismSnapshotId: string | null;
    offerSnapshotId: string | null;
    awarenessSnapshotId?: string | null;
    funnelSnapshotId?: string | null;
    funnelSnapshotIds?: string[];
    persuasionSnapshotId?: string | null;
    persuasionSnapshotIds?: string[];
    channelSelectionSnapshotId?: string | null;
    budgetGovernorSnapshotId?: string | null;
    integritySnapshotId?: string | null;
    statisticalValidationSnapshotId?: string | null;
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
    // LATEST_VIEWABLE: when an approved designatedActivePlan exists, it remains the canonical
    // strategy & execution authority across all views unless the caller explicitly requests
    // CANDIDATE_DRAFT or a specific draft planId. candidateDraftPlan is still returned on
    // the context so Strategy Plan UI can surface a review banner for newer unapproved drafts.
    selectedPlan = designatedActivePlan || candidateDraftPlan || null;
    effectiveMode =
      selectedPlan && designatedActivePlan && selectedPlan.id === designatedActivePlan.id
        ? "APPROVED_ACTIVE"
        : selectedPlan && candidateDraftPlan && selectedPlan.id === candidateDraftPlan.id
        ? "CANDIDATE_DRAFT"
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
  let planSnapshotIds: Record<string, any> = {};
  let parsedPlanObj: any = null;
  if (selectedPlan?.planJson) {
    try {
      const parsedPlan =
        typeof selectedPlan.planJson === "string"
          ? JSON.parse(selectedPlan.planJson)
          : selectedPlan.planJson;
      parsedPlanObj = parsedPlan;
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

  // Resolve businessId, productId, offeringId from campaign_offerings / businesses / business_products
  let businessId: string | null = parsedPlanObj?.businessId || null;
  let productId: string | null = parsedPlanObj?.productId || null;
  let offeringId: string | null = parsedPlanObj?.offeringId || parsedPlanObj?.selectedOfferingId || null;
  try {
    const [offRow] = await db
      .select({
        id: schema.campaignOfferings.id,
        businessId: schema.campaignOfferings.businessId,
        productId: schema.campaignOfferings.productId,
      })
      .from(schema.campaignOfferings)
      .where(eq(schema.campaignOfferings.campaignId, campaignId))
      .orderBy(desc(schema.campaignOfferings.createdAt))
      .limit(1);
    if (offRow) {
      offeringId = offRow.id || offeringId;
      businessId = offRow.businessId || businessId;
      productId = offRow.productId || productId;
    }
    if (!businessId) {
      const [bizRow] = await db
        .select({ id: schema.businesses.id })
        .from(schema.businesses)
        .where(eq(schema.businesses.accountId, accountId))
        .orderBy(desc(schema.businesses.createdAt))
        .limit(1);
      if (bizRow) businessId = bizRow.id;
    }
    if (!productId && businessId) {
      const [prodRow] = await db
        .select({ id: schema.businessProducts.id })
        .from(schema.businessProducts)
        .where(eq(schema.businessProducts.businessId, businessId))
        .orderBy(desc(schema.businessProducts.createdAt))
        .limit(1);
      if (prodRow) productId = prodRow.id;
    }
  } catch {}

  const rawFunnel = planSnapshotIds.funnel || planSnapshotIds.funnelSnapshotIds;
  const funnelIdSet = new Set<string>(
    Array.isArray(rawFunnel)
      ? rawFunnel.filter((x: any) => typeof x === "string" && x.length > 0)
      : typeof rawFunnel === "string" && rawFunnel.length > 0
        ? [rawFunnel]
        : []
  );
  const rawPersuasion = planSnapshotIds.persuasion || planSnapshotIds.persuasionSnapshotIds;
  const persuasionIdSet = new Set<string>(
    Array.isArray(rawPersuasion)
      ? rawPersuasion.filter((x: any) => typeof x === "string" && x.length > 0)
      : typeof rawPersuasion === "string" && rawPersuasion.length > 0
        ? [rawPersuasion]
        : []
  );

  if (Array.isArray(parsedPlanObj?.buyerConversionJourneys)) {
    for (const j of parsedPlanObj.buyerConversionJourneys) {
      if (typeof j?.sourceFunnelSnapshotId === "string" && j.sourceFunnelSnapshotId) {
        funnelIdSet.add(j.sourceFunnelSnapshotId);
      }
      if (typeof j?.sourcePersuasionSnapshotId === "string" && j.sourcePersuasionSnapshotId) {
        persuasionIdSet.add(j.sourcePersuasionSnapshotId);
      }
    }
  }
  if (Array.isArray(parsedPlanObj?.strategicFunnels)) {
    for (const sf of parsedPlanObj.strategicFunnels) {
      if (typeof sf?.snapshotId === "string" && sf.snapshotId) {
        funnelIdSet.add(sf.snapshotId);
      }
      if (typeof sf?.sourceFunnelSnapshotId === "string" && sf.sourceFunnelSnapshotId) {
        funnelIdSet.add(sf.sourceFunnelSnapshotId);
      }
    }
  }
  if (selectedPlan?.jobId && (funnelIdSet.size < 2 || persuasionIdSet.size < 2)) {
    try {
      const jobFunnels = await db
        .select({ id: schema.funnelSnapshots.id })
        .from(schema.funnelSnapshots)
        .where(and(eq(schema.funnelSnapshots.campaignId, campaignId), eq(schema.funnelSnapshots.jobId, selectedPlan.jobId)));
      for (const jf of jobFunnels) funnelIdSet.add(jf.id);

      const jobPers = await db
        .select({ id: schema.persuasionSnapshots.id })
        .from(schema.persuasionSnapshots)
        .where(and(eq(schema.persuasionSnapshots.campaignId, campaignId), eq(schema.persuasionSnapshots.jobId, selectedPlan.jobId)));
      for (const jp of jobPers) persuasionIdSet.add(jp.id);
    } catch {}
  }

  const funnelSnapshotIds: string[] = Array.from(funnelIdSet);
  const persuasionSnapshotIds: string[] = Array.from(persuasionIdSet);

  const isDraftPreview = Boolean(selectedPlan && selectedPlan.status === "DRAFT");
  const isDesignatedActive = Boolean(
    selectedPlan &&
      ((designatedActivePlan && selectedPlan.id === designatedActivePlan.id) || selectedPlan.isDesignatedActive)
  );

  return {
    accountId,
    businessId,
    productId,
    offeringId,
    campaignId,
    mode: effectiveMode,
    selectedPlan,
    designatedActivePlan,
    candidateDraftPlan,
    strategyRoot,
    rootBundle,
    jobId: selectedPlan?.jobId || strategyRoot?.runId || specificRunId || null,
    planId: selectedPlan?.id || null,
    planVersion: (selectedPlan as any)?.versionNumber || (selectedPlan as any)?.version || null,
    strategyRootId: strategyRoot?.id || null,
    strategyRootVersion: null,
    rootBundleId: rootBundle?.id || selectedPlan?.rootBundleId || null,
    rootBundleVersion: rootBundle?.version || selectedPlan?.rootBundleVersion || null,
    isDraftPreview,
    isDesignatedActive,
    isHistoricalOnly,
    snapshotIds: {
      businessUnderstandingSnapshotId:
        planSnapshotIds.businessUnderstanding || planSnapshotIds.business_understanding || null,
      miSnapshotId: planSnapshotIds.market_intelligence || strategyRoot?.miSnapshotId || null,
      audienceSnapshotId: planSnapshotIds.audience || strategyRoot?.audienceSnapshotId || null,
      positioningSnapshotId: planSnapshotIds.positioning || strategyRoot?.positioningSnapshotId || null,
      differentiationSnapshotId: planSnapshotIds.differentiation || strategyRoot?.differentiationSnapshotId || null,
      mechanismSnapshotId: planSnapshotIds.mechanism || strategyRoot?.mechanismSnapshotId || null,
      offerSnapshotId: planSnapshotIds.offer || (strategyRoot as any)?.offerSnapshotId || null,
      awarenessSnapshotId: planSnapshotIds.awareness || null,
      funnelSnapshotId: funnelSnapshotIds[0] || null,
      funnelSnapshotIds,
      persuasionSnapshotId: persuasionSnapshotIds[0] || null,
      persuasionSnapshotIds,
      channelSelectionSnapshotId:
        planSnapshotIds.channel_selection || planSnapshotIds.channelSelection || null,
      budgetGovernorSnapshotId:
        planSnapshotIds.budget_governor || planSnapshotIds.budgetGovernor || null,
      integritySnapshotId: planSnapshotIds.integrity || null,
      statisticalValidationSnapshotId:
        planSnapshotIds.statistical_validation || planSnapshotIds.statisticalValidation || null,
    },
  };
}

