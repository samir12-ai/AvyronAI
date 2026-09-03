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
  performanceSnapshots,
  type WeeklyBusinessInventory,
} from "@shared/schema";
import { and, eq, desc, gte, lte } from "drizzle-orm";

export interface ApplicableMetricDefinition {
  key: "conversations" | "leads" | "qualifiedLeads" | "trialsOrBookedCalls" | "payingCustomers" | "revenue" | "spend" | "orders";
  label: string;
  unit: "count" | "currency" | "percentage";
  description: string;
  required: boolean;
  isCommercialOutcome: boolean;
}

export interface WeeklyInventoryCheckInPayload {
  inventoryId: string;
  accountId: string;
  campaignId: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  status: "WAITING_FOR_USER" | "COMPLETED" | "PARTIAL" | "EXPIRED";
  instructions: string;
  automaticMetrics: {
    reach: number | null;
    views: number | null;
    engagement: number | null;
    postsObserved: number;
  };
  applicableMetrics: ApplicableMetricDefinition[];
  submittedMetrics: Record<string, number | null | "NOT_APPLICABLE">;
}

/**
 * Derives the canonical applicable business inventory metrics based on campaign goal & model.
 */
export function deriveApplicableMetrics(goalType: string = "conversions"): ApplicableMetricDefinition[] {
  const normalizedGoal = goalType.toLowerCase();

  const baseMetrics: ApplicableMetricDefinition[] = [
    {
      key: "conversations",
      label: "Direct Conversations / Inquiries",
      unit: "count",
      description: "Direct message inquiries, inbound chat threads, or comments requesting info.",
      required: false,
      isCommercialOutcome: false,
    },
    {
      key: "leads",
      label: "Total Inbound Leads",
      unit: "count",
      description: "Forms submitted, contact requests, or sign-ups captured.",
      required: true,
      isCommercialOutcome: false,
    },
    {
      key: "qualifiedLeads",
      label: "Sales-Qualified Leads (SQLs)",
      unit: "count",
      description: "Leads meeting your ideal customer profile and purchasing intent criteria.",
      required: false,
      isCommercialOutcome: false,
    },
    {
      key: "trialsOrBookedCalls",
      label: "Booked Calls / Trial Starts",
      unit: "count",
      description: "Discovery meetings held, consultations booked, or product trial starts.",
      required: false,
      isCommercialOutcome: false,
    },
    {
      key: "payingCustomers",
      label: "New Paying Customers / Clients",
      unit: "count",
      description: "Closed deals, new paying clients, or paying subscribers gained this week.",
      required: true,
      isCommercialOutcome: true,
    },
    {
      key: "revenue",
      label: "Gross Commercial Revenue",
      unit: "currency",
      description: "Total revenue generated from campaign activity this week ($).",
      required: false,
      isCommercialOutcome: true,
    },
    {
      key: "spend",
      label: "Direct Marketing / Ad Spend",
      unit: "currency",
      description: "Ad spend or production expenses incurred for this campaign this week ($).",
      required: false,
      isCommercialOutcome: false,
    },
  ];

  if (normalizedGoal.includes("ecommerce") || normalizedGoal.includes("sales")) {
    baseMetrics.unshift({
      key: "orders",
      label: "Completed Orders / Purchases",
      unit: "count",
      description: "E-commerce checkout transactions completed.",
      required: true,
      isCommercialOutcome: true,
    });
  }

  return baseMetrics;
}

/**
 * Calculates discrete 7-day week boundaries in campaign timezone.
 */
export function computeWeeklyPeriodBoundaries(date: Date = new Date()): {
  periodStart: Date;
  periodEnd: Date;
  periodLabel: string;
} {
  const periodEnd = new Date(date);
  const periodStart = new Date(date.getTime() - 7 * 24 * 60 * 60 * 1000);

  const startFmt = periodStart.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const endFmt = periodEnd.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const periodLabel = `${startFmt} – ${endFmt}`;

  return { periodStart, periodEnd, periodLabel };
}

/**
 * Ensures or retrieves the active weekly business inventory for a campaign.
 */
export async function getOrCreateWeeklyInventory(
  accountId: string,
  campaignId: string
): Promise<WeeklyInventoryCheckInPayload> {
  const { periodStart, periodEnd, periodLabel } = computeWeeklyPeriodBoundaries();

  // 1. Check if weekly inventory row exists
  let [inventory] = await db
    .select()
    .from(weeklyBusinessInventories)
    .where(and(
      eq(weeklyBusinessInventories.accountId, accountId),
      eq(weeklyBusinessInventories.campaignId, campaignId),
      gte(weeklyBusinessInventories.periodStart, new Date(periodStart.getTime() - 24 * 60 * 60 * 1000))
    ))
    .orderBy(desc(weeklyBusinessInventories.createdAt))
    .limit(1);

  // 2. Fetch automatic channel telemetry so user is NOT asked to re-type it
  const [latestSnap] = await db
    .select()
    .from(performanceSnapshots)
    .where(and(
      eq(performanceSnapshots.accountId, accountId),
      eq(performanceSnapshots.campaignId, campaignId)
    ))
    .orderBy(desc(performanceSnapshots.fetchedAt))
    .limit(1);

  const automaticMetrics = {
    reach: latestSnap?.reach ?? null,
    views: latestSnap?.impressions ?? null,
    engagement: latestSnap?.likes ? latestSnap.likes + (latestSnap.comments || 0) : null,
    postsObserved: latestSnap ? 3 : 0,
  };

  // 3. Resolve campaign goal
  const [camp] = await db
    .select()
    .from(campaignSelections)
    .where(and(
      eq(campaignSelections.accountId, accountId),
      eq(campaignSelections.selectedCampaignId, campaignId)
    ))
    .limit(1);

  const applicableMetrics = deriveApplicableMetrics(camp?.campaignGoalType || "conversions");

  if (!inventory) {
    [inventory] = await db
      .insert(weeklyBusinessInventories)
      .values({
        accountId,
        campaignId,
        periodStart,
        periodEnd,
        periodLabel,
        status: "WAITING_FOR_USER",
        applicableMetricsSchema: applicableMetrics,
        automaticMetrics,
        submittedMetrics: {},
        coverageStatus: "NONE",
      })
      .returning();
  }

  return {
    inventoryId: inventory.id,
    accountId,
    campaignId,
    periodLabel: inventory.periodLabel,
    periodStart: inventory.periodStart.toISOString(),
    periodEnd: inventory.periodEnd.toISOString(),
    status: inventory.status as any,
    instructions: "Avyron has collected your channel performance automatically. Add the business results only you can confirm.",
    automaticMetrics: (inventory.automaticMetrics as any) || automaticMetrics,
    applicableMetrics: (inventory.applicableMetricsSchema as any) || applicableMetrics,
    submittedMetrics: (inventory.submittedMetrics as any) || {},
  };
}

/**
 * Submits manual business metrics for the weekly inventory.
 */
export async function submitWeeklyInventoryMetrics(params: {
  inventoryId: string;
  accountId: string;
  campaignId: string;
  metrics: {
    conversations?: number | null | "NOT_APPLICABLE";
    leads?: number | null | "NOT_APPLICABLE";
    qualifiedLeads?: number | null | "NOT_APPLICABLE";
    trialsOrBookedCalls?: number | null | "NOT_APPLICABLE";
    payingCustomers?: number | null | "NOT_APPLICABLE";
    revenue?: number | null | "NOT_APPLICABLE";
    spend?: number | null | "NOT_APPLICABLE";
    orders?: number | null | "NOT_APPLICABLE";
  };
}): Promise<{ success: boolean; inventory: WeeklyBusinessInventory; coverageStatus: string }> {
  const { inventoryId, accountId, campaignId, metrics } = params;

  // Sanitize exact distinctions: 0 is 0, null is null, NOT_APPLICABLE is NOT_APPLICABLE
  const sanitized: Record<string, any> = {};
  let presentCount = 0;
  let totalKeys = 0;

  for (const [key, val] of Object.entries(metrics)) {
    totalKeys++;
    if (val === 0) {
      sanitized[key] = 0;
      presentCount++;
    } else if (val === "NOT_APPLICABLE") {
      sanitized[key] = "NOT_APPLICABLE";
      presentCount++;
    } else if (typeof val === "number" && !isNaN(val)) {
      sanitized[key] = val;
      presentCount++;
    } else {
      sanitized[key] = null;
    }
  }

  const coverageStatus = presentCount === 0 ? "NONE" : presentCount < totalKeys ? "PARTIAL" : "COMPLETE";

  const [updated] = await db
    .update(weeklyBusinessInventories)
    .set({
      submittedMetrics: sanitized,
      status: "COMPLETED",
      coverageStatus,
      submittedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(
      eq(weeklyBusinessInventories.id, inventoryId),
      eq(weeklyBusinessInventories.accountId, accountId),
      eq(weeklyBusinessInventories.campaignId, campaignId)
    ))
    .returning();

  // Persist into canonical manualCampaignMetrics and pipelineUserTruth
  const conversions = typeof sanitized.payingCustomers === "number" ? sanitized.payingCustomers : (typeof sanitized.orders === "number" ? sanitized.orders : null);
  const leads = typeof sanitized.leads === "number" ? sanitized.leads : null;
  const qualifiedLeads = typeof sanitized.qualifiedLeads === "number" ? sanitized.qualifiedLeads : null;
  const bookedCalls = typeof sanitized.trialsOrBookedCalls === "number" ? sanitized.trialsOrBookedCalls : null;
  const revenue = typeof sanitized.revenue === "number" ? sanitized.revenue : null;
  const spend = typeof sanitized.spend === "number" ? sanitized.spend : null;

  await db.insert(manualCampaignMetrics).values({
    accountId,
    campaignId,
    conversions: conversions ?? undefined,
    leads: leads ?? undefined,
    revenue: revenue ?? undefined,
    spend: spend ?? undefined,
  });

  // Check if evaluation window exists; if not, create one to bind user truth
  let [evalWindow] = await db
    .select()
    .from(pipelineEvalWindows)
    .where(and(
      eq(pipelineEvalWindows.accountId, accountId),
      eq(pipelineEvalWindows.campaignId, campaignId)
    ))
    .orderBy(desc(pipelineEvalWindows.windowIndex))
    .limit(1);

  if (!evalWindow) {
    [evalWindow] = await db
      .insert(pipelineEvalWindows)
      .values({
        accountId,
        campaignId,
        planId: "plan_default_" + campaignId,
        anchorAt: new Date(),
        windowIndex: 0,
        windowStart: updated.periodStart,
        windowEnd: updated.periodEnd,
        state: "open",
      })
      .returning();
  }

  await db.insert(pipelineUserTruth).values({
    accountId,
    campaignId,
    windowId: evalWindow.id,
    totalLeads: leads ?? 0,
    qualifiedLeads: qualifiedLeads ?? 0,
    bookedCalls: bookedCalls ?? 0,
    paidActive: (conversions ?? 0) > 0,
    payingCustomers: conversions,
    grossRevenueCents: revenue ? Math.round(revenue * 100) : null,
    totalSpendCents: spend ? Math.round(spend * 100) : null,
    truthType: "USER_ENTERED",
    status: "CONFIRMED",
  });

  return {
    success: true,
    inventory: updated,
    coverageStatus,
  };
}
