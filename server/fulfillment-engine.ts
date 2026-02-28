import { db } from "./db";
import { studioItems, requiredWork, strategicPlans } from "@shared/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { getBranchForMediaType, type FulfillmentBranch } from "../lib/media-types";

export interface BranchFulfillment {
  required: number;
  fulfilled: number;
  remaining: number;
}

export interface FulfillmentResult {
  total: {
    required: number;
    fulfilled: number;
    remaining: number;
  };
  byBranch: {
    VIDEO: BranchFulfillment;
    DESIGNER: BranchFulfillment;
    WRITER: BranchFulfillment;
  };
  byStatus: {
    draft: number;
    ready: number;
    scheduled: number;
    published: number;
    failed: number;
  };
  progressPercent: number;
  planId: string | null;
}

export async function computeFulfillment(
  campaignId: string,
  accountId: string = "default"
): Promise<FulfillmentResult> {
  const activePlanStatuses = [
    "APPROVED",
    "GENERATED_TO_CALENDAR",
    "CREATIVE_GENERATED",
    "REVIEW",
    "SCHEDULED",
    "PUBLISHED",
  ];

  const plans = await db
    .select({ id: strategicPlans.id })
    .from(strategicPlans)
    .where(
      and(
        eq(strategicPlans.accountId, accountId),
        eq(strategicPlans.campaignId, campaignId),
        sql`${strategicPlans.status} IN (${sql.join(
          activePlanStatuses.map((s) => sql`${s}`),
          sql`, `
        )})`
      )
    )
    .orderBy(sql`${strategicPlans.createdAt} DESC`);

  const activePlanIds = plans.map((p) => p.id);

  let workRec: any = null;
  if (activePlanIds.length > 0) {
    const workRows = await db
      .select()
      .from(requiredWork)
      .where(
        and(
          inArray(requiredWork.planId, activePlanIds),
          eq(requiredWork.campaignId, campaignId)
        )
      )
      .orderBy(sql`${requiredWork.createdAt} DESC`)
      .limit(1);
    workRec = workRows[0] || null;
  }

  const requiredByBranch = {
    VIDEO: workRec?.videoItems || 0,
    DESIGNER: workRec?.designerItems || 0,
    WRITER: workRec?.writerItems || 0,
  };
  const totalRequired = workRec?.totalContentPieces || 0;

  const siRows = await db
    .select({
      contentType: studioItems.contentType,
      status: studioItems.status,
    })
    .from(studioItems)
    .where(
      and(
        eq(studioItems.campaignId, campaignId),
        eq(studioItems.accountId, accountId)
      )
    );

  const fulfilledByBranch: Record<FulfillmentBranch, number> = {
    VIDEO: 0,
    DESIGNER: 0,
    WRITER: 0,
  };
  const statusCounts = {
    draft: 0,
    ready: 0,
    scheduled: 0,
    published: 0,
    failed: 0,
  };

  for (const item of siRows) {
    const branch = getBranchForMediaType(item.contentType);
    fulfilledByBranch[branch]++;
    countStatus(statusCounts, item.status);
  }

  const totalFulfilled =
    fulfilledByBranch.VIDEO +
    fulfilledByBranch.DESIGNER +
    fulfilledByBranch.WRITER;

  const totalRemaining = Math.max(0, totalRequired - totalFulfilled);

  const progressPercent =
    totalRequired > 0
      ? Math.min(100, Math.round((totalFulfilled / totalRequired) * 100))
      : 0;

  return {
    total: {
      required: totalRequired,
      fulfilled: totalFulfilled,
      remaining: totalRemaining,
    },
    byBranch: {
      VIDEO: {
        required: requiredByBranch.VIDEO,
        fulfilled: fulfilledByBranch.VIDEO,
        remaining: Math.max(
          0,
          requiredByBranch.VIDEO - fulfilledByBranch.VIDEO
        ),
      },
      DESIGNER: {
        required: requiredByBranch.DESIGNER,
        fulfilled: fulfilledByBranch.DESIGNER,
        remaining: Math.max(
          0,
          requiredByBranch.DESIGNER - fulfilledByBranch.DESIGNER
        ),
      },
      WRITER: {
        required: requiredByBranch.WRITER,
        fulfilled: fulfilledByBranch.WRITER,
        remaining: Math.max(
          0,
          requiredByBranch.WRITER - fulfilledByBranch.WRITER
        ),
      },
    },
    byStatus: statusCounts,
    progressPercent,
    planId: activePlanIds[0] || null,
  };
}

function countStatus(
  counts: Record<string, number>,
  status: string | null
): void {
  if (!status) return;
  const s = status.toUpperCase();
  if (s === "DRAFT") counts.draft++;
  else if (s === "READY") counts.ready++;
  else if (s === "SCHEDULED" || s === "SCHEDULE") counts.scheduled++;
  else if (s === "PUBLISHED") counts.published++;
  else if (s === "FAILED") counts.failed++;
}
