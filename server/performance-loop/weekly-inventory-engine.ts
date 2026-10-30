/**
 * Avyron — Weekly Manual Business Inventory Engine.
 *
 * DOCTRINE:
 * 1. Single Weekly Period: Exactly one weekly business stocktake per campaign week.
 * 2. Applicable Metrics: Derived dynamically from business model & goal math (not random).
 * 3. Automatic Merge: Never ask the user to re-type reach/views/engagement already observed.
 * 4. Exact Distinctions: 0 (confirmed zero) != null (missing) != NOT_APPLICABLE != UNKNOWN.
 * 5. Lifecycle: WEEKLY_METRICS_REQUIRED -> WAITING_FOR_USER -> Submit -> Persist -> Trigger Eval.
 * 6. Partial Coverage: Partial submissions remain honestly partial without inventing data.
 */

import { db } from "../db";
import {
  weeklyBusinessInventories,
  manualCampaignMetrics,
  pipelineUserTruth,
  pipelineEvalWindows,
  campaignSelections,
  campaignBudgetSettings,
  ownedPosts,
  ownedPostSnapshots,
  performanceSnapshots,
  notifications,
  type WeeklyBusinessInventory,
} from "@shared/schema";
import { and, eq, desc, gte, inArray, like, or } from "drizzle-orm";
import { evaluateWindowState } from "../pipeline/eval-windows";
import { resolveEffectiveNow, resolveCampaignReportingTimezone } from "./clock";

export function isWeeklyInventoryDue(
  inv: { status: string; periodEnd: Date | string },
  now: Date = new Date()
): boolean {
  const periodEndMs = new Date(inv.periodEnd).getTime();
  if (Number.isNaN(periodEndMs)) return false;
  const isElapsed = now.getTime() >= periodEndMs;
  const isFinalized = inv.status === "COMPLETED" || inv.status === "EXPIRED";
  return isElapsed && !isFinalized;
}

export class WeeklyInventoryValidationError extends Error {
  status: number;
  code: string;
  constructor(message: string, code: string = "INVALID_WEEKLY_INVENTORY", status: number = 400) {
    super(message);
    this.name = "WeeklyInventoryValidationError";
    this.code = code;
    this.status = status;
  }
}

export interface ApplicableMetricDefinition {
  key: "conversations" | "leads" | "qualifiedLeads" | "trialsOrBookedCalls" | "payingCustomers" | "revenue" | "spend" | "orders";
  label: string;
  unit: "count" | "currency" | "percentage";
  currencyCode?: string;
  description: string;
  whyNeeded: string;
  required: boolean;
  isCommercialOutcome: boolean;
}

export interface AutomaticSocialTelemetry {
  // 1. Strictly scoped to the 7-day reporting window [periodStart, periodEnd]
  windowPostsPublished: number;
  windowPublishedPostsViews: number | null;
  windowPublishedPostsEngagement: number;
  windowAllPostsViewDelta: number | null;
  windowTelemetryNote: string;
  // 2. Stored Historical Totals (explicitly separated so never confused with 7-day window activity)
  storedHistoricalPostsCount: number;
  cumulativeHistoricalViews: number | null;
  cumulativeHistoricalEngagement: number | null;
  // Backwards-compatible fields (reflecting strictly in-window published posts)
  reach: number | null;
  views: number | null;
  engagement: number | null;
  postsObserved: number;
}

export interface WeeklyInventoryCheckInPayload {
  inventoryId: string;
  accountId: string;
  campaignId: string;
  planId: string | null;
  windowId: string | null;
  windowIndex: number | null;
  currency: string;
  reportingTimezone: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  dueAt: string;
  nextCheckInDueAt: string;
  isWindowInProgress: boolean;
  isDue: boolean;
  windowCompletionState: "IN_PROGRESS" | "ELAPSED";
  lifecycleState: "OPEN_IN_PROGRESS" | "PARTIAL_SAVED_IN_PROGRESS" | "DUE_AWAITING_FINAL" | "COMPLETED";
  status: "WAITING_FOR_USER" | "COMPLETED" | "PARTIAL" | "EXPIRED";
  coverageStatus: string;
  lastUpdatedThrough: string | null;
  submittedAt: string | null;
  completedAt: string | null;
  editedAt?: string | null;
  instructions: string;
  automaticMetrics: AutomaticSocialTelemetry;
  applicableMetrics: ApplicableMetricDefinition[];
  submittedMetrics: Record<string, any>;
  userMetrics: {
    leads: number | null;
    conversions: number | null;
    payingCustomers: number | null;
    revenue: number | null;
    adSpend: number | null;
    spend: number | null;
    qualifiedLeads: number | null;
    conversations: number | null;
    trialsOrBookedCalls: number | null;
    orders: number | null;
    notes: string | null;
    asOfTimestamp: string | null;
    windowCompletionState: string | null;
  };
}

export function extractUserMetricsFromInventoryRow(inventory: WeeklyBusinessInventory): WeeklyInventoryCheckInPayload["userMetrics"] {
  const sub = ((inventory.submittedMetrics as any) || {}) as Record<string, any>;
  const invAny = inventory as any;
  return {
    leads: typeof sub.leads === "number" ? sub.leads : (invAny.leadsCount ?? null),
    conversions:
      typeof sub.payingCustomers === "number"
        ? sub.payingCustomers
        : typeof sub.conversions === "number"
          ? sub.conversions
          : (invAny.newCustomersCount ?? null),
    payingCustomers:
      typeof sub.payingCustomers === "number"
        ? sub.payingCustomers
        : typeof sub.conversions === "number"
          ? sub.conversions
          : (invAny.newCustomersCount ?? null),
    revenue:
      typeof sub.revenue === "number"
        ? sub.revenue
        : invAny.revenueAmount != null
          ? Number(invAny.revenueAmount)
          : null,
    adSpend:
      typeof sub.spend === "number"
        ? sub.spend
        : typeof sub.adSpend === "number"
          ? sub.adSpend
          : invAny.adSpendAmount != null
            ? Number(invAny.adSpendAmount)
            : null,
    spend:
      typeof sub.spend === "number"
        ? sub.spend
        : typeof sub.adSpend === "number"
          ? sub.adSpend
          : invAny.adSpendAmount != null
            ? Number(invAny.adSpendAmount)
            : null,
    qualifiedLeads:
      typeof sub.qualifiedLeads === "number" ? sub.qualifiedLeads : (invAny.qualifiedLeadsCount ?? null),
    conversations:
      typeof sub.conversations === "number" ? sub.conversations : (invAny.conversationsCount ?? null),
    trialsOrBookedCalls:
      typeof sub.trialsOrBookedCalls === "number" ? sub.trialsOrBookedCalls : (invAny.trialsOrCallsCount ?? null),
    orders: typeof sub.orders === "number" ? sub.orders : (invAny.ordersCount ?? null),
    notes: typeof sub.notes === "string" ? sub.notes : null,
    asOfTimestamp: typeof sub._asOfTimestamp === "string" ? sub._asOfTimestamp : null,
    windowCompletionState: typeof sub._windowCompletionState === "string" ? sub._windowCompletionState : null,
  };
}

export function formatWeeklyInventoryHistoryRow(
  inventory: WeeklyBusinessInventory,
  reportingTimezone: string = "Asia/Dubai"
) {
  const sub = ((inventory.submittedMetrics as any) || {}) as Record<string, any>;
  const userMetrics = extractUserMetricsFromInventoryRow(inventory);
  const completedAt =
    typeof sub._completedAt === "string"
      ? sub._completedAt
      : inventory.submittedAt
        ? new Date(inventory.submittedAt).toISOString()
        : new Date(inventory.updatedAt).toISOString();
  const editedAt = typeof sub._editedAt === "string" ? sub._editedAt : null;

  return {
    id: inventory.id,
    inventoryId: inventory.id,
    accountId: inventory.accountId,
    campaignId: inventory.campaignId,
    planId: inventory.planId,
    windowId: inventory.windowId,
    windowIndex: inventory.windowIndex,
    currency: inventory.currency || "USD",
    reportingTimezone,
    periodStart: new Date(inventory.periodStart).toISOString(),
    periodEnd: new Date(inventory.periodEnd).toISOString(),
    periodLabel: inventory.periodLabel,
    status: inventory.status,
    coverageStatus: inventory.coverageStatus || "COMPLETE",
    submittedAt: inventory.submittedAt ? new Date(inventory.submittedAt).toISOString() : completedAt,
    completedAt,
    editedAt,
    automaticMetrics: (inventory.automaticMetrics as any) || null,
    submittedMetrics: sub,
    userMetrics,
  };
}

/**
 * Derives the canonical applicable business inventory metrics based on campaign goal & model.
 */
export function deriveApplicableMetrics(goalType: string = "conversions", currency: string = "USD"): ApplicableMetricDefinition[] {
  const normalizedGoal = goalType.toLowerCase();

  const baseMetrics: ApplicableMetricDefinition[] = [
    {
      key: "conversations",
      label: "Direct Conversations / Inquiries",
      unit: "count",
      description: "Direct message inquiries, inbound chat threads, or comments requesting info during this 7-day window.",
      whyNeeded: "Distinguishes whether content engagement is turning into active prospect conversations.",
      required: false,
      isCommercialOutcome: false,
    },
    {
      key: "leads",
      label: "Total Inbound Leads",
      unit: "count",
      description: "Forms submitted, contact requests, or sign-ups captured during this 7-day window.",
      whyNeeded: "Measures top-of-funnel lead capture pace against your active strategy plan.",
      required: true,
      isCommercialOutcome: false,
    },
    {
      key: "qualifiedLeads",
      label: "Sales-Qualified Leads (SQLs)",
      unit: "count",
      description: "Leads meeting your ideal customer profile and purchasing intent criteria.",
      whyNeeded: "Diagnoses whether audience targeting is attracting qualified buyers or low-intent traffic.",
      required: false,
      isCommercialOutcome: false,
    },
    {
      key: "trialsOrBookedCalls",
      label: "Booked Calls / Song Previews / Trial Starts",
      unit: "count",
      description: "Discovery meetings held, song previews generated, consultations booked, or trial starts.",
      whyNeeded: "Evaluates middle-of-funnel offer consideration and mechanism conversion.",
      required: false,
      isCommercialOutcome: false,
    },
    {
      key: "payingCustomers",
      label: "New Paying Customers / Clients",
      unit: "count",
      description: "Closed orders, new paying customers, or paying subscribers gained during this 7-day window.",
      whyNeeded: "Verifies bottom-of-funnel conversion truth that public social scraping cannot observe.",
      required: true,
      isCommercialOutcome: true,
    },
    {
      key: "revenue",
      label: `Gross Commercial Revenue (${currency})`,
      unit: "currency",
      currencyCode: currency,
      description: `Total gross revenue generated from campaign activity during this 7-day window (${currency}).`,
      whyNeeded: "Calculates return on marketing effort and validates commercial growth.",
      required: false,
      isCommercialOutcome: true,
    },
    {
      key: "spend",
      label: `Direct Marketing / Ad Spend (${currency})`,
      unit: "currency",
      currencyCode: currency,
      description: `Ad spend or direct promotion expenses incurred during this 7-day window (${currency}).`,
      whyNeeded: "Required to compute Customer Acquisition Cost (CPA) and Return on Ad Spend (ROAS).",
      required: false,
      isCommercialOutcome: false,
    },
  ];

  if (normalizedGoal.includes("ecommerce") || normalizedGoal.includes("sales")) {
    baseMetrics.unshift({
      key: "orders",
      label: "Completed Orders / Purchases",
      unit: "count",
      description: "E-commerce checkout transactions completed during this 7-day window.",
      whyNeeded: "Measures direct checkout volume across the reporting window.",
      required: true,
      isCommercialOutcome: true,
    });
  }

  return baseMetrics;
}

/**
 * Calculates discrete 7-day week boundaries (fallback when no active approved plan exists).
 */
export function computeWeeklyPeriodBoundaries(date: Date = new Date()): {
  periodStart: Date;
  periodEnd: Date;
  periodLabel: string;
} {
  const periodEnd = new Date(date);
  const periodStart = new Date(date.getTime() - 7 * 24 * 60 * 60 * 1000);

  const startFmt = periodStart.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const endFmt = periodEnd.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const periodLabel = `${startFmt} – ${endFmt}`;

  return { periodStart, periodEnd, periodLabel };
}

/**
 * Ensures or retrieves the active weekly business inventory for a campaign,
 * anchored to the active approved plan's reporting window in `pipeline_eval_windows`.
 */
export async function getOrCreateWeeklyInventory(
  accountId: string,
  campaignId: string,
  nowOverride?: Date
): Promise<WeeklyInventoryCheckInPayload> {
  const now = resolveEffectiveNow(campaignId, nowOverride);
  const ws = await evaluateWindowState(accountId, campaignId, now);

  // Resolve campaign currency, timezone & goal, plus existing weekly inventory rows
  const [[camp], [budgetSetting], ownedPostRows, existingRows] = await Promise.all([
    db
      .select()
      .from(campaignSelections)
      .where(and(
        eq(campaignSelections.accountId, accountId),
        eq(campaignSelections.selectedCampaignId, campaignId)
      ))
      .limit(1),
    db
      .select()
      .from(campaignBudgetSettings)
      .where(and(
        eq(campaignBudgetSettings.accountId, accountId),
        eq(campaignBudgetSettings.campaignId, campaignId)
      ))
      .limit(1),
    db
      .select()
      .from(ownedPosts)
      .where(and(
        eq(ownedPosts.accountId, accountId),
        eq(ownedPosts.campaignId, campaignId)
      )),
    db
      .select()
      .from(weeklyBusinessInventories)
      .where(and(
        eq(weeklyBusinessInventories.accountId, accountId),
        eq(weeklyBusinessInventories.campaignId, campaignId)
      ))
      .orderBy(desc(weeklyBusinessInventories.periodEnd), desc(weeklyBusinessInventories.createdAt))
      .limit(20),
  ]);

  const reportingTimezone = resolveCampaignReportingTimezone(camp?.campaignLocation);
  const currency = budgetSetting?.currency || "USD";
  const applicableMetrics = deriveApplicableMetrics(camp?.campaignGoalType || "conversions", currency);

  // Expire any uncompleted inventories belonging to a superseded plan so obsolete plans never block the active plan
  const activePlanId = ws.activePlan?.id || null;
  for (const r of existingRows) {
    if (
      activePlanId &&
      r.planId &&
      r.planId !== activePlanId &&
      (r.status === "WAITING_FOR_USER" || r.status === "PARTIAL")
    ) {
      await db
        .update(weeklyBusinessInventories)
        .set({ status: "EXPIRED", nextReminderAt: null, updatedAt: now })
        .where(eq(weeklyBusinessInventories.id, r.id));
      r.status = "EXPIRED";
    }
  }

  // Check if a reporting period has already ended (periodEnd <= now) and is STILL awaiting final figures
  // (status is WAITING_FOR_USER or PARTIAL — partial mid-week saves do NOT cancel the end-of-period check-in!).
  const dueElapsedRows = existingRows.filter(
    (r) =>
      (!activePlanId || !r.planId || r.planId === activePlanId) &&
      isWeeklyInventoryDue(r, now)
  );

  // If multiple historical uncompleted windows somehow accumulated, keep only the latest due window active
  // and expire older ones so the user sees one clear "Weekly check-in due" card.
  if (dueElapsedRows.length > 1) {
    for (const staleRow of dueElapsedRows.slice(1)) {
      await db
        .update(weeklyBusinessInventories)
        .set({ status: "EXPIRED", nextReminderAt: null, updatedAt: now })
        .where(eq(weeklyBusinessInventories.id, staleRow.id));
      staleRow.status = "EXPIRED";
    }
  }

  const activeDueInventory = dueElapsedRows[0] || null;

  let periodStart: Date;
  let periodEnd: Date;
  let periodLabel: string;
  let planId: string | null = null;
  let windowId: string | null = null;
  let windowIndex: number | null = null;

  if (activeDueInventory) {
    periodStart = new Date(activeDueInventory.periodStart);
    periodEnd = new Date(activeDueInventory.periodEnd);
    periodLabel = activeDueInventory.periodLabel;
    planId = activeDueInventory.planId ?? activePlanId;
    windowId = activeDueInventory.windowId ?? null;
    windowIndex = activeDueInventory.windowIndex ?? 0;
  } else if (ws.window && ws.activePlan) {
    periodStart = ws.window.windowStart;
    periodEnd = ws.window.windowEnd;
    planId = ws.activePlan.id;
    windowId = ws.window.id;
    windowIndex = ws.window.windowIndex;
    const startFmt = periodStart.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const endFmt = periodEnd.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    periodLabel = `${startFmt} – ${endFmt} (Window #${windowIndex + 1})`;
  } else {
    const fallback = computeWeeklyPeriodBoundaries(now);
    periodStart = fallback.periodStart;
    periodEnd = fallback.periodEnd;
    periodLabel = fallback.periodLabel;
  }

  // Separate:
  // 1) Stored historical channel totals across all stored posts in DB
  // 2) Posts published strictly inside the 7-day reporting window [periodStart, periodEnd]
  // 3) Engagement / views measured on window-published posts vs. historical posts
  const postIds = ownedPostRows.map((p) => p.id);
  const postSnaps =
    postIds.length > 0
      ? await db
          .select()
          .from(ownedPostSnapshots)
          .where(inArray(ownedPostSnapshots.ownedPostId, postIds))
          .orderBy(desc(ownedPostSnapshots.observedAt))
      : [];
  const latestSnapByPost = new Map<string, (typeof postSnaps)[0]>();
  for (const s of postSnaps) {
    if (!latestSnapByPost.has(s.ownedPostId)) latestSnapByPost.set(s.ownedPostId, s);
  }

  let totalHistoricalViews = 0;
  let hasHistoricalViews = false;
  let totalHistoricalEngagement = 0;

  let windowPostsPublished = 0;
  let windowPublishedViews = 0;
  let hasWindowPublishedViews = false;
  let windowPublishedEngagement = 0;

  const pStartMs = periodStart.getTime();
  const pEndMs = periodEnd.getTime();

  for (const p of ownedPostRows) {
    const s = latestSnapByPost.get(p.id);
    const v = typeof s?.views === "number" ? s.views : null;
    const eng = (s?.likes ?? 0) + (s?.comments ?? 0);

    if (v !== null) {
      totalHistoricalViews += v;
      hasHistoricalViews = true;
    }
    totalHistoricalEngagement += eng;

    const postedMs = p.postedAt ? new Date(p.postedAt).getTime() : null;
    if (postedMs !== null && postedMs >= pStartMs && postedMs <= pEndMs) {
      windowPostsPublished++;
      if (v !== null) {
        windowPublishedViews += v;
        hasWindowPublishedViews = true;
      }
      windowPublishedEngagement += eng;
    }
  }

  const automaticMetrics: AutomaticSocialTelemetry = {
    // 1. Strictly scoped to the 7-day reporting window [periodStart, periodEnd]
    windowPostsPublished,
    windowPublishedPostsViews: windowPostsPublished > 0 ? (hasWindowPublishedViews ? windowPublishedViews : null) : 0,
    windowPublishedPostsEngagement: windowPostsPublished > 0 ? windowPublishedEngagement : 0,
    windowAllPostsViewDelta: null, // Public social scrapers provide cumulative post views, not 7-day period deltas on older posts
    windowTelemetryNote:
      windowPostsPublished === 0
        ? `0 new posts published during this 7-day window (${periodStart.toISOString().slice(0, 10)} → ${periodEnd.toISOString().slice(0, 10)}). 7-day view deltas on older historical posts are unknown from public snapshots.`
        : `${windowPostsPublished} post(s) published during this 7-day window.`,
    // 2. Stored Historical Totals (explicitly separated so never confused with 7-day window activity)
    storedHistoricalPostsCount: ownedPostRows.length,
    cumulativeHistoricalViews: hasHistoricalViews ? totalHistoricalViews : null,
    cumulativeHistoricalEngagement: ownedPostRows.length > 0 ? totalHistoricalEngagement : null,
    // Backwards-compatible keys reflect strictly in-window published posts (never cumulative historical archive)
    reach: null,
    views: windowPostsPublished > 0 ? (hasWindowPublishedViews ? windowPublishedViews : null) : null,
    engagement: windowPostsPublished > 0 ? windowPublishedEngagement : 0,
    postsObserved: windowPostsPublished,
  };

  let inventory =
    activeDueInventory ||
    (windowId ? existingRows.find((r) => (r as any).windowId === windowId && r.status !== "EXPIRED") : undefined) ||
    existingRows.find(
      (r) =>
        r.status !== "EXPIRED" &&
        Math.abs(r.periodStart.getTime() - periodStart.getTime()) < 12 * 60 * 60 * 1000
    ) ||
    null;

  const existingAuto = (inventory?.automaticMetrics || {}) as any;
  const needsAutoReconcile =
    existingAuto.windowPostsPublished !== automaticMetrics.windowPostsPublished ||
    existingAuto.storedHistoricalPostsCount !== automaticMetrics.storedHistoricalPostsCount ||
    existingAuto.postsObserved !== automaticMetrics.postsObserved;

  if (!inventory) {
    [inventory] = await db
      .insert(weeklyBusinessInventories)
      .values({
        accountId,
        campaignId,
        planId,
        windowId,
        windowIndex,
        periodStart,
        periodEnd,
        periodLabel,
        currency,
        status: "WAITING_FOR_USER",
        applicableMetricsSchema: applicableMetrics,
        automaticMetrics,
        submittedMetrics: {},
        coverageStatus: "NONE",
      } as any)
      .returning();
  } else if (
    (!activeDueInventory && (inventory as any).windowId !== windowId && windowId) ||
    inventory.periodLabel !== periodLabel ||
    inventory.currency !== currency ||
    needsAutoReconcile
  ) {
    const [reconciled] = await db
      .update(weeklyBusinessInventories)
      .set({
        planId,
        windowId,
        windowIndex,
        periodStart,
        periodEnd,
        periodLabel,
        currency,
        automaticMetrics,
        applicableMetricsSchema: applicableMetrics,
        updatedAt: now,
      } as any)
      .where(eq(weeklyBusinessInventories.id, inventory.id))
      .returning();
    if (reconciled) inventory = reconciled;
  }

  const sub = ((inventory.submittedMetrics as any) || {}) as Record<string, any>;
  const isWindowInProgress = now.getTime() < inventory.periodEnd.getTime();
  const isDue = isWeeklyInventoryDue(inventory, now);
  const windowCompletionState: "IN_PROGRESS" | "ELAPSED" = isWindowInProgress ? "IN_PROGRESS" : "ELAPSED";
  const lifecycleState: WeeklyInventoryCheckInPayload["lifecycleState"] =
    inventory.status === "COMPLETED"
      ? "COMPLETED"
      : isDue
        ? "DUE_AWAITING_FINAL"
        : inventory.status === "PARTIAL"
          ? "PARTIAL_SAVED_IN_PROGRESS"
          : "OPEN_IN_PROGRESS";

  const userMetrics = extractUserMetricsFromInventoryRow(inventory);
  const lastUpdatedThrough =
    userMetrics.asOfTimestamp ||
    (inventory.submittedAt ? new Date(inventory.submittedAt).toISOString() : null);
  const completedAt =
    typeof sub._completedAt === "string"
      ? sub._completedAt
      : inventory.status === "COMPLETED" && inventory.submittedAt
        ? new Date(inventory.submittedAt).toISOString()
        : null;

  return {
    inventoryId: inventory.id,
    accountId,
    campaignId,
    planId: (inventory as any).planId ?? planId,
    windowId: (inventory as any).windowId ?? windowId,
    windowIndex: (inventory as any).windowIndex ?? windowIndex,
    currency: inventory.currency || currency,
    reportingTimezone,
    periodLabel: inventory.periodLabel || periodLabel,
    periodStart: inventory.periodStart.toISOString(),
    periodEnd: inventory.periodEnd.toISOString(),
    dueAt: inventory.periodEnd.toISOString(),
    nextCheckInDueAt: inventory.periodEnd.toISOString(),
    isWindowInProgress,
    isDue,
    windowCompletionState,
    lifecycleState,
    status: inventory.status as any,
    coverageStatus: inventory.coverageStatus || "NONE",
    lastUpdatedThrough,
    submittedAt: inventory.submittedAt ? new Date(inventory.submittedAt).toISOString() : null,
    completedAt,
    editedAt: typeof sub._editedAt === "string" ? sub._editedAt : null,
    instructions: isWindowInProgress
      ? `This 7-day plan window is currently in progress (ends ${inventory.periodEnd.toISOString().slice(0, 10)}). Submitting metrics now saves an as-of partial check-in without closing the 7-day window early. Enter 0 for confirmed zero; leave blank if unknown.`
      : "Avyron has collected your public social channel telemetry automatically. Enter the commercial results for this completed 7-day plan window (enter 0 if none occurred; leave blank if unknown).",
    automaticMetrics: (inventory.automaticMetrics as any) || automaticMetrics,
    applicableMetrics: (inventory.applicableMetricsSchema as any) || applicableMetrics,
    submittedMetrics: sub,
    userMetrics,
  };
}

export interface SubmitWeeklyInventoryResult {
  success: boolean;
  saved: boolean;
  inventory: WeeklyBusinessInventory;
  coverageStatus: string;
  isWindowInProgress: boolean;
  windowCompletionState: "IN_PROGRESS_AS_OF" | "COMPLETED";
  evaluationStatus: "COMPLETED" | "DEFERRED_ERROR";
  evaluationError: string | null;
  executionStateId?: string | null;
  performanceContextId?: string | null;
  reasoningSync?: {
    casesCreated: number;
    decisionsCreated: number;
    casesSkippedIdempotent: number;
  } | null;
}

const COUNT_METRIC_KEYS = new Set([
  "conversations",
  "leads",
  "qualifiedLeads",
  "trialsOrBookedCalls",
  "payingCustomers",
  "conversions",
  "orders",
]);

const CURRENCY_METRIC_KEYS = new Set(["revenue", "spend", "adSpend"]);

/**
 * Submits manual business metrics for the weekly inventory.
 * Preserves explicit 0 vs. null (unknown), enforces in-progress vs. completed 7-day window semantics,
 * updates pipeline_user_truth idempotently without double counting, and separates persistence from downstream evaluation.
 */
export async function submitWeeklyInventoryMetrics(params: {
  inventoryId: string;
  accountId: string;
  campaignId: string;
  metrics: {
    conversations?: number | string | null | "NOT_APPLICABLE";
    leads?: number | string | null | "NOT_APPLICABLE";
    qualifiedLeads?: number | string | null | "NOT_APPLICABLE";
    trialsOrBookedCalls?: number | string | null | "NOT_APPLICABLE";
    payingCustomers?: number | string | null | "NOT_APPLICABLE";
    conversions?: number | string | null | "NOT_APPLICABLE";
    revenue?: number | string | null | "NOT_APPLICABLE";
    spend?: number | string | null | "NOT_APPLICABLE";
    adSpend?: number | string | null | "NOT_APPLICABLE";
    orders?: number | string | null | "NOT_APPLICABLE";
    notes?: string | null;
  };
  nowOverride?: Date;
  simulateDownstreamFailure?: boolean;
}): Promise<SubmitWeeklyInventoryResult> {
  const { inventoryId, accountId, campaignId, metrics } = params;

  if (!inventoryId || !metrics || typeof metrics !== "object" || Array.isArray(metrics)) {
    throw new WeeklyInventoryValidationError(
      "inventoryId and metrics object are required.",
      "MISSING_REQUIRED_FIELDS",
      400
    );
  }

  // 1. Verify inventory exists and validate tenant/campaign ownership
  const [existingInventory] = await db
    .select()
    .from(weeklyBusinessInventories)
    .where(eq(weeklyBusinessInventories.id, inventoryId))
    .limit(1);

  if (!existingInventory) {
    throw new WeeklyInventoryValidationError(
      `WeeklyBusinessInventory ${inventoryId} not found.`,
      "INVENTORY_NOT_FOUND",
      404
    );
  }
  if (existingInventory.accountId !== accountId) {
    throw new WeeklyInventoryValidationError(
      `WeeklyBusinessInventory ${inventoryId} does not belong to the authenticated account.`,
      "TENANT_OWNERSHIP_MISMATCH",
      403
    );
  }
  if (existingInventory.campaignId !== campaignId) {
    throw new WeeklyInventoryValidationError(
      `WeeklyBusinessInventory ${inventoryId} does not belong to campaign ${campaignId}.`,
      "CAMPAIGN_RELATIONSHIP_MISMATCH",
      400
    );
  }

  // 2. Validate and normalize metrics: 0 is 0, null/"" is null (unknown), NOT_APPLICABLE is NOT_APPLICABLE.
  // Reject negative or unparseable values.
  const sanitized: Record<string, any> = {};
  let presentCount = 0;
  let totalKeys = 0;

  for (const [key, val] of Object.entries(metrics)) {
    if (key.startsWith("_")) continue;
    if (key === "notes") {
      if (typeof val === "string" && val.trim() !== "") {
        sanitized.notes = val.trim();
      } else {
        sanitized.notes = null;
      }
      continue;
    }

    if (!COUNT_METRIC_KEYS.has(key) && !CURRENCY_METRIC_KEYS.has(key)) {
      continue;
    }

    totalKeys++;
    if (val === null || val === undefined || (typeof val === "string" && val.trim() === "")) {
      sanitized[key] = null;
      continue;
    }
    if (val === "NOT_APPLICABLE") {
      sanitized[key] = "NOT_APPLICABLE";
      presentCount++;
      continue;
    }

    const parsedNum = typeof val === "number" ? val : Number(String(val).trim());
    if (!Number.isFinite(parsedNum) || parsedNum < 0) {
      throw new WeeklyInventoryValidationError(
        `Invalid value for '${key}': must be a non-negative number (enter 0 for confirmed zero, or leave blank if unknown).`,
        "INVALID_METRIC_VALUE",
        400
      );
    }
    if (COUNT_METRIC_KEYS.has(key) && !Number.isInteger(parsedNum)) {
      throw new WeeklyInventoryValidationError(
        `Invalid value for '${key}': count metrics must be whole integers.`,
        "INVALID_METRIC_INTEGER",
        400
      );
    }

    sanitized[key] = parsedNum;
    presentCount++;
  }

  // Normalize aliases so both payingCustomers/conversions and spend/adSpend stay consistent
  if (sanitized.payingCustomers === undefined && sanitized.conversions !== undefined) {
    sanitized.payingCustomers = sanitized.conversions;
  }
  if (sanitized.conversions === undefined && sanitized.payingCustomers !== undefined) {
    sanitized.conversions = sanitized.payingCustomers;
  }
  if (sanitized.spend === undefined && sanitized.adSpend !== undefined) {
    sanitized.spend = sanitized.adSpend;
  }
  if (sanitized.adSpend === undefined && sanitized.spend !== undefined) {
    sanitized.adSpend = sanitized.spend;
  }

  if (presentCount === 0 && !sanitized.notes) {
    throw new WeeklyInventoryValidationError(
      "Please enter at least one 7-day metric (enter 0 if confirmed zero, or leave unknown fields blank while providing known metrics).",
      "EMPTY_WEEKLY_METRICS",
      400
    );
  }

  const now = resolveEffectiveNow(campaignId, params.nowOverride);
  const isAlreadyCompleted = existingInventory.status === "COMPLETED";
  const isWindowElapsed = isAlreadyCompleted || now.getTime() >= existingInventory.periodEnd.getTime();
  const isWindowInProgress = !isWindowElapsed;
  const windowCompletionState: "IN_PROGRESS_AS_OF" | "COMPLETED" = isWindowElapsed
    ? "COMPLETED"
    : "IN_PROGRESS_AS_OF";

  const prevSub = ((existingInventory.submittedMetrics as any) || {}) as Record<string, any>;
  sanitized._windowCompletionState = windowCompletionState;
  sanitized._asOfTimestamp = now.toISOString();
  if (isWindowElapsed) {
    sanitized._completedAt =
      typeof prevSub._completedAt === "string"
        ? prevSub._completedAt
        : isAlreadyCompleted && existingInventory.submittedAt
          ? new Date(existingInventory.submittedAt).toISOString()
          : now.toISOString();
  }
  if (isAlreadyCompleted) {
    sanitized._editedAt = now.toISOString();
  }

  const coverageStatus = isWindowInProgress
    ? "IN_PROGRESS_AS_OF"
    : presentCount === 0
      ? "NONE"
      : presentCount < 2
        ? "PARTIAL"
        : "COMPLETE";

  // Critical invariant:
  // 1) Do NOT mark a 7-day window inventory COMPLETED early when the 7-day period is still in progress!
  // 2) Do NOT reopen an already COMPLETED check-in when it is edited from History!
  const nextStatus = isWindowElapsed ? "COMPLETED" : "PARTIAL";

  const numOrNull = (v: any): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const conversions =
    numOrNull(sanitized.payingCustomers) ??
    numOrNull(sanitized.conversions) ??
    numOrNull(sanitized.orders);
  const leads = numOrNull(sanitized.leads);
  const qualifiedLeads = numOrNull(sanitized.qualifiedLeads);
  const conversations = numOrNull(sanitized.conversations);
  const bookedCalls = numOrNull(sanitized.trialsOrBookedCalls);
  const orders = numOrNull(sanitized.orders);
  const revenue = numOrNull(sanitized.revenue);
  const spend = numOrNull(sanitized.spend) ?? numOrNull(sanitized.adSpend);

  // Resolve canonical currency from campaignBudgetSettings
  const [budgetSetting] = await db
    .select()
    .from(campaignBudgetSettings)
    .where(and(eq(campaignBudgetSettings.accountId, accountId), eq(campaignBudgetSettings.campaignId, campaignId)))
    .limit(1);
  const canonicalCurrency = budgetSetting?.currency || existingInventory.currency || "USD";

  // STEP 1: Persist weekly inventory metrics and cancel reminders FIRST (separated from downstream evaluation)
  const [updated] = await db
    .update(weeklyBusinessInventories)
    .set({
      currency: canonicalCurrency,
      leadsCount: leads,
      qualifiedLeadsCount: qualifiedLeads,
      conversationsCount: conversations,
      trialsOrCallsCount: bookedCalls,
      newCustomersCount: conversions,
      ordersCount: orders,
      revenueAmount: revenue != null ? String(revenue) : null,
      adSpendAmount: spend != null ? String(spend) : null,
      submittedMetrics: sanitized,
      status: nextStatus,
      coverageStatus,
      submittedAt: isAlreadyCompleted && existingInventory.submittedAt ? existingInventory.submittedAt : now,
      completedAt: isWindowElapsed ? now : null,
      nextReminderAt: null,
      updatedAt: now,
    } as any)
    .where(
      and(
        eq(weeklyBusinessInventories.id, inventoryId),
        eq(weeklyBusinessInventories.accountId, accountId),
        eq(weeklyBusinessInventories.campaignId, campaignId)
      )
    )
    .returning();

  // Bind to canonical evaluation window and update pipeline_user_truth idempotently (no duplicate rows on later edits)
  const ws = await evaluateWindowState(accountId, campaignId, now);
  const targetWindowId = (existingInventory as any).windowId || ws.window?.id || null;

  if (targetWindowId) {
    const [existingTruth] = await db
      .select()
      .from(pipelineUserTruth)
      .where(
        and(
          eq(pipelineUserTruth.accountId, accountId),
          eq(pipelineUserTruth.campaignId, campaignId),
          eq(pipelineUserTruth.windowId, targetWindowId)
        )
      )
      .orderBy(desc(pipelineUserTruth.createdAt))
      .limit(1);

    let truthRowId: string | null = null;
    if (existingTruth) {
      const [updatedTruth] = await db
        .update(pipelineUserTruth)
        .set({
          totalLeads: leads ?? 0,
          qualifiedLeads: qualifiedLeads ?? 0,
          bookedCalls: bookedCalls ?? 0,
          paidActive: (conversions ?? 0) > 0,
          payingCustomers: conversions,
          grossRevenueCents: revenue != null ? Math.round(revenue * 100) : null,
          totalSpendCents: spend != null ? Math.round(spend * 100) : null,
          truthType: "USER_ENTERED",
          status: isWindowElapsed ? "CONFIRMED" : "PARTIAL_IN_PROGRESS",
        })
        .where(eq(pipelineUserTruth.id, existingTruth.id))
        .returning();
      truthRowId = updatedTruth?.id || existingTruth.id;
    } else {
      const [insertedTruth] = await db
        .insert(pipelineUserTruth)
        .values({
          accountId,
          campaignId,
          windowId: targetWindowId,
          totalLeads: leads ?? 0,
          qualifiedLeads: qualifiedLeads ?? 0,
          bookedCalls: bookedCalls ?? 0,
          paidActive: (conversions ?? 0) > 0,
          payingCustomers: conversions,
          grossRevenueCents: revenue != null ? Math.round(revenue * 100) : null,
          totalSpendCents: spend != null ? Math.round(spend * 100) : null,
          truthType: "USER_ENTERED",
          status: isWindowElapsed ? "CONFIRMED" : "PARTIAL_IN_PROGRESS",
        })
        .returning();
      truthRowId = insertedTruth?.id || null;
    }

    if (truthRowId) {
      // Only close the evaluation window if the 7-day period has actually elapsed!
      await db
        .update(pipelineEvalWindows)
        .set({
          truthId: truthRowId,
          ...(isWindowElapsed ? { state: "closed", closedAt: now } : {}),
        })
        .where(eq(pipelineEvalWindows.id, targetWindowId));
    }
  }

  // Reconcile notifications:
  // - If window is still in progress (partial save before periodEnd), remove any premature due notifications so the real due notification fires at periodEnd.
  // - If window has elapsed (final submission or history edit), mark due and reminder notifications as read.
  try {
    if (isWindowInProgress) {
      await db
        .delete(notifications)
        .where(
          and(
            eq(notifications.campaignId, campaignId),
            or(
              eq(notifications.sourceEntityId, inventoryId),
              like(notifications.sourceEntityId, `${inventoryId}_reminder_%`)
            )
          )
        );
    } else {
      await db
        .update(notifications)
        .set({ isRead: true, readAt: now })
        .where(
          and(
            eq(notifications.campaignId, campaignId),
            or(
              eq(notifications.sourceEntityId, inventoryId),
              like(notifications.sourceEntityId, `${inventoryId}_reminder_%`)
            )
          )
        );
    }
  } catch {}

  // If this submission finalized a due period, ensure the next reporting period is immediately available
  let nextReportingWindow: WeeklyInventoryCheckInPayload | null = null;
  if (isWindowElapsed && !isAlreadyCompleted) {
    try {
      nextReportingWindow = await getOrCreateWeeklyInventory(accountId, campaignId, now);
    } catch {}
  }

  // STEP 2: Trigger immediate Performance Loop re-evaluation and Deep Reasoning handoff in a guarded block
  try {
    if (params.simulateDownstreamFailure) {
      throw new Error("Simulated downstream Performance evaluation failure after weekly metrics saved.");
    }
    const { evaluateAndPersistBusinessExecutionState } = await import("./execution-intelligence");
    const evalResult = await evaluateAndPersistBusinessExecutionState({
      accountId,
      campaignId,
      userAnswerContext: `7-day reporting window (${existingInventory.periodLabel}, state=${windowCompletionState}) check-in submitted: leads=${leads ?? "unknown"}, payingCustomers=${conversions ?? "unknown"}, revenue=${revenue != null ? `${canonicalCurrency} ${revenue}` : "unknown"}, adSpend=${spend != null ? `${canonicalCurrency} ${spend}` : "unknown"}.`,
    });

    return {
      success: true,
      saved: true,
      submittedAt: now.toISOString(),
      inventory: updated,
      coverageStatus,
      isWindowInProgress,
      isEditedHistory: isAlreadyCompleted,
      windowCompletionState,
      windowCompletionSemantics: windowCompletionState,
      nextReportingWindow,
      evaluationStatus: "COMPLETED",
      evaluationError: null,
      executionStateId: evalResult.executionState?.id ?? null,
      performanceContextId: evalResult.performanceContext?.id ?? null,
      dossier: evalResult.dossier ?? null,
      reasoningSync: evalResult.reasoningSync ?? null,
    } as any;
  } catch (evalErr: any) {
    console.warn(`[WeeklyInventoryEngine] Metrics saved (${inventoryId}), but downstream evaluation deferred: ${evalErr?.message || evalErr}`);
    return {
      success: true,
      saved: true,
      submittedAt: now.toISOString(),
      inventory: updated,
      coverageStatus,
      isWindowInProgress,
      isEditedHistory: isAlreadyCompleted,
      windowCompletionState,
      windowCompletionSemantics: windowCompletionState,
      nextReportingWindow,
      evaluationStatus: "DEFERRED_ERROR",
      evaluationError: evalErr?.message || "Downstream evaluation failed after saving weekly metrics.",
      executionStateId: null,
      performanceContextId: null,
      dossier: null,
      reasoningSync: null,
    } as any;
  }
}
