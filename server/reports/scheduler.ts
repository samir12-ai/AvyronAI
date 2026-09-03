import { db } from "../db";
import * as schema from "@shared/schema";
import { eq, and, desc, sql, lte, gte } from "drizzle-orm";
import {
  calculatePeriodBounds,
  assembleMonthlyReportPayload,
  generateOrGetMonthlyReport,
  type MonthlyReportPayload,
} from "./monthly-report-engine";

export const LEASE_DURATION_MS = 5 * 60 * 1000; // 5 minutes lease

export interface DueReportPeriod {
  year: number;
  month: number;
  periodStart: Date;
  periodEnd: Date;
}

export async function getDueReportPeriods(opts: {
  accountId: string;
  campaignId: string;
  campaignCreatedAt?: Date;
  timezone?: string;
  referenceTime?: Date;
}): Promise<DueReportPeriod[]> {
  const { accountId, campaignId, campaignCreatedAt, timezone = "UTC", referenceTime = new Date() } = opts;

  // Determine start month to look back:
  // Campaign creation date or up to 6 months in the past
  const startRef = campaignCreatedAt || new Date(referenceTime.getTime() - 90 * 24 * 60 * 60 * 1000);
  const startYear = startRef.getUTCFullYear();
  const startMonth = startRef.getUTCMonth() + 1; // 1-indexed

  const currentYear = referenceTime.getUTCFullYear();
  const currentMonth = referenceTime.getUTCMonth() + 1;

  const duePeriods: DueReportPeriod[] = [];

  // Iterate chronologically from startYear/startMonth to currentYear/currentMonth
  let iterYear = startYear;
  let iterMonth = startMonth;

  while (iterYear < currentYear || (iterYear === currentYear && iterMonth <= currentMonth)) {
    const { periodStart, periodEnd, isPastMonth } = calculatePeriodBounds(iterYear, iterMonth, timezone, referenceTime);

    // Only closed/past months can be due for automatic finalization
    if (isPastMonth) {
      // Check if a FINALIZED report already exists
      const existing = await db
        .select()
        .from(schema.monthlyReports)
        .where(
          and(
            eq(schema.monthlyReports.campaignId, campaignId),
            eq(schema.monthlyReports.reportPeriodYear, iterYear),
            eq(schema.monthlyReports.reportPeriodMonth, iterMonth)
          )
        )
        .limit(1);

      if (existing.length === 0 || existing[0].status !== "FINALIZED") {
        duePeriods.push({
          year: iterYear,
          month: iterMonth,
          periodStart,
          periodEnd,
        });
      }
    }

    iterMonth++;
    if (iterMonth > 12) {
      iterMonth = 1;
      iterYear++;
    }
  }

  return duePeriods;
}

export async function claimAndGenerateMonthlyReport(opts: {
  accountId: string;
  campaignId: string;
  year: number;
  month: number;
  timezone?: string;
  referenceTime?: Date;
  workerId?: string;
}): Promise<{
  status: "FINALIZED" | "SKIPPED" | "FAILED";
  reportId?: string;
  reason?: string;
  report?: schema.MonthlyReportRow;
}> {
  const {
    accountId,
    campaignId,
    year,
    month,
    timezone = "UTC",
    referenceTime = new Date(),
    workerId = "worker_default",
  } = opts;

  const { periodStart, periodEnd, isPastMonth } = calculatePeriodBounds(year, month, timezone, referenceTime);

  // If month is not closed yet in campaign timezone, do not finalize
  if (!isPastMonth) {
    return {
      status: "SKIPPED",
      reason: "MONTH_NOT_CLOSED_YET",
    };
  }

  // 1. Check existing row
  const existingRows = await db
    .select()
    .from(schema.monthlyReports)
    .where(
      and(
        eq(schema.monthlyReports.campaignId, campaignId),
        eq(schema.monthlyReports.reportPeriodYear, year),
        eq(schema.monthlyReports.reportPeriodMonth, month)
      )
    )
    .limit(1);

  const now = referenceTime.getTime();
  let existing = existingRows[0];

  if (existing) {
    if (existing.status === "FINALIZED") {
      return {
        status: "SKIPPED",
        reason: "REPORT_ALREADY_FINALIZED",
        reportId: existing.id,
        report: existing,
      };
    }

    // If currently GENERATING, check lease expiration (crash recovery)
    if (existing.status === "GENERATING") {
      const meta = (existing.metadata || {}) as any;
      const leaseExpiresAt = meta.leaseExpiresAt ? new Date(meta.leaseExpiresAt).getTime() : 0;
      if (leaseExpiresAt > now) {
        return {
          status: "SKIPPED",
          reason: "IN_FLIGHT_LEASE_ACTIVE",
          reportId: existing.id,
        };
      }
      // Lease expired => crash recovery, proceed to reclaim
    }
  }

  // 2. Claim row by setting status = 'GENERATING' with lease
  const leaseExpiresAt = new Date(now + LEASE_DURATION_MS);
  let reportRowId = existing?.id;

  try {
    if (existing) {
      await db
        .update(schema.monthlyReports)
        .set({
          status: "GENERATING",
          metadata: {
            claimedBy: workerId,
            claimedAt: new Date(now).toISOString(),
            leaseExpiresAt: leaseExpiresAt.toISOString(),
          },
          updatedAt: new Date(now),
        })
        .where(eq(schema.monthlyReports.id, existing.id));
    } else {
      const [inserted] = await db
        .insert(schema.monthlyReports)
        .values({
          accountId,
          campaignId,
          reportPeriodYear: year,
          reportPeriodMonth: month,
          periodStart,
          periodEnd,
          timezone,
          status: "GENERATING",
          metadata: {
            claimedBy: workerId,
            claimedAt: new Date(now).toISOString(),
            leaseExpiresAt: leaseExpiresAt.toISOString(),
          },
        })
        .returning();
      reportRowId = inserted.id;
    }
  } catch (claimErr: any) {
    // Unique constraint violation means another worker claimed simultaneously
    return {
      status: "SKIPPED",
      reason: "CLAIM_RACE_LOST",
    };
  }

  // 3. Assemble and validate payload
  try {
    const { payload, lineage } = await assembleMonthlyReportPayload(
      accountId,
      campaignId,
      year,
      month,
      timezone,
      true
    );

    // 4. Mark as FINALIZED
    const [finalized] = await db
      .update(schema.monthlyReports)
      .set({
        status: "FINALIZED",
        generatedAt: new Date(now),
        finalizedAt: new Date(now),
        strategyRootIds: lineage.strategyRootIds,
        rootBundleVersions: lineage.rootBundleVersions,
        strategicPlanIds: lineage.strategicPlanIds,
        watchtowerEventIds: lineage.watchtowerEventIds,
        reasoningCaseIds: lineage.reasoningCaseIds,
        adaptiveDecisionIds: lineage.adaptiveDecisionIds,
        strategyChangeProposalIds: lineage.strategyChangeProposalIds,
        strategyAdaptationLineageIds: lineage.strategyAdaptationLineageIds,
        executionDayIds: lineage.executionDayIds,
        executionTaskIds: lineage.executionTaskIds,
        sourceMetricIds: lineage.sourceMetricIds,
        reportPayload: payload,
        metadata: {
          finalizedBy: workerId,
          finalizedAt: new Date(now).toISOString(),
        },
        updatedAt: new Date(now),
      })
      .where(eq(schema.monthlyReports.id, reportRowId!))
      .returning();

    return {
      status: "FINALIZED",
      reportId: finalized.id,
      report: finalized,
    };
  } catch (genErr: any) {
    console.error(`[MonthlyReportsScheduler] Generation failed for ${campaignId} ${year}-${month}:`, genErr);
    if (reportRowId) {
      await db
        .update(schema.monthlyReports)
        .set({
          status: "FAILED",
          metadata: {
            error: genErr.message,
            failedAt: new Date(now).toISOString(),
          },
          updatedAt: new Date(now),
        })
        .where(eq(schema.monthlyReports.id, reportRowId));
    }

    return {
      status: "FAILED",
      reason: genErr.message,
      reportId: reportRowId,
    };
  }
}

export async function runMonthlyReportSchedulerSweep(opts?: {
  referenceTime?: Date;
  specificCampaignId?: string;
  workerId?: string;
}): Promise<{
  campaignsScanned: number;
  reportsGenerated: number;
  reportsSkipped: number;
  dueCount: number;
  errors: string[];
}> {
  const referenceTime = opts?.referenceTime || new Date();
  const workerId = opts?.workerId || "monthly_report_scheduler";
  const errors: string[] = [];
  let reportsGenerated = 0;
  let reportsSkipped = 0;
  let dueCount = 0;

  // Query campaigns from strategicPlans and campaignSelections
  let campaigns: Array<{ id: string; accountId: string; createdAt: Date; timezone?: string }> = [];

  if (opts?.specificCampaignId) {
    // Look in strategic_plans first, then campaign_selections
    const plans = await db
      .select({
        accountId: schema.strategicPlans.accountId,
        campaignId: schema.strategicPlans.campaignId,
        createdAt: schema.strategicPlans.createdAt,
      })
      .from(schema.strategicPlans)
      .where(eq(schema.strategicPlans.campaignId, opts.specificCampaignId))
      .limit(1);

    if (plans.length > 0) {
      campaigns = [{
        id: plans[0].campaignId,
        accountId: plans[0].accountId,
        createdAt: plans[0].createdAt || new Date(),
        timezone: "Asia/Dubai",
      }];
    } else {
      const sel = await db
        .select()
        .from(schema.campaignSelections)
        .where(eq(schema.campaignSelections.selectedCampaignId, opts.specificCampaignId))
        .limit(1);

      if (sel.length > 0) {
        campaigns = [{
          id: sel[0].selectedCampaignId,
          accountId: sel[0].accountId,
          createdAt: sel[0].createdAt || new Date(),
          timezone: "Asia/Dubai",
        }];
      }
    }
  } else {
    // Scan all distinct campaigns from strategic_plans
    const planRows = await db
      .select({
        accountId: schema.strategicPlans.accountId,
        campaignId: schema.strategicPlans.campaignId,
        createdAt: sql<Date>`MIN(${schema.strategicPlans.createdAt})`,
      })
      .from(schema.strategicPlans)
      .groupBy(schema.strategicPlans.accountId, schema.strategicPlans.campaignId);

    const seen = new Set<string>();
    for (const p of planRows) {
      if (p.campaignId && !seen.has(p.campaignId)) {
        seen.add(p.campaignId);
        campaigns.push({
          id: p.campaignId,
          accountId: p.accountId,
          createdAt: p.createdAt || new Date(),
          timezone: "Asia/Dubai",
        });
      }
    }
  }

  for (const camp of campaigns) {
    try {
      const duePeriods = await getDueReportPeriods({
        accountId: camp.accountId,
        campaignId: camp.id,
        campaignCreatedAt: camp.createdAt,
        timezone: camp.timezone,
        referenceTime,
      });

      dueCount += duePeriods.length;

      for (const period of duePeriods) {
        const res = await claimAndGenerateMonthlyReport({
          accountId: camp.accountId,
          campaignId: camp.id,
          year: period.year,
          month: period.month,
          timezone: camp.timezone,
          referenceTime,
          workerId,
        });

        if (res.status === "FINALIZED") {
          reportsGenerated++;
        } else if (res.status === "SKIPPED") {
          reportsSkipped++;
        } else {
          errors.push(`Campaign ${camp.id} ${period.year}-${period.month}: ${res.reason}`);
        }
      }
    } catch (campErr: any) {
      errors.push(`Campaign ${camp.id} scan failed: ${campErr.message}`);
    }
  }

  return {
    campaignsScanned: campaigns.length,
    reportsGenerated,
    reportsSkipped,
    dueCount,
    errors,
  };
}
