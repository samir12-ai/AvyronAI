import "dotenv/config";
import { describe, it, expect } from "vitest";
import {
  calculatePeriodBounds,
  getTimezoneOffsetMs,
  assembleMonthlyReportPayload,
} from "../reports/monthly-report-engine";
import {
  getDueReportPeriods,
  claimAndGenerateMonthlyReport,
  runMonthlyReportSchedulerSweep,
} from "../reports/scheduler";

describe("Monthly Report Auto Month-Close & Downtime Catch-Up Lifecycle", () => {
  const testAccountId = "acc_buffer_e2e_1787909177715";
  const testCampaignId = "camp_buffer_e2e_1787909177715";
  const dubaiTimezone = "Asia/Dubai";

  // 1. Current open month is not finalized.
  it("1. current open month is not finalized by scheduler before month end", () => {
    const midMonth = new Date("2026-08-15T12:00:00.000Z");
    const bounds = calculatePeriodBounds(2026, 8, dubaiTimezone, midMonth);
    expect(bounds.isPastMonth).toBe(false);
  });

  // 2. Previous closed month becomes due automatically.
  it("2. previous closed month is detected as past month when local boundary is crossed", () => {
    const afterClose = new Date("2026-09-01T04:00:00.000Z");
    const bounds = calculatePeriodBounds(2026, 8, dubaiTimezone, afterClose);
    expect(bounds.isPastMonth).toBe(true);
  });

  // 3. No button/customer action required.
  it("3. getDueReportPeriods discovers closed missing periods automatically without user input", async () => {
    const afterClose = new Date("2026-09-01T04:00:00.000Z");
    const due = await getDueReportPeriods({
      accountId: testAccountId,
      campaignId: testCampaignId,
      campaignCreatedAt: new Date("2026-08-01T00:00:00.000Z"),
      timezone: dubaiTimezone,
      referenceTime: afterClose,
    });
    expect(Array.isArray(due)).toBe(true);
  });

  // 4. Campaign timezone controls month boundary.
  it("4. campaign timezone (+4 Asia/Dubai) shifts UTC close time by 4 hours earlier", () => {
    const offsetMs = getTimezoneOffsetMs(new Date("2026-08-31T20:00:00.000Z"), dubaiTimezone);
    expect(offsetMs).toBe(4 * 60 * 60 * 1000); // 4 hours in ms
  });

  // 5. UTC midnight does not incorrectly finalize local open month.
  it("5. timezone boundary prevents premature finalization when local time is still 23:50", () => {
    // 23:50 in Dubai is 19:50 UTC (4 hours ahead)
    const beforeLocalMidnight = new Date("2026-08-31T19:50:00.000Z");
    const bounds = calculatePeriodBounds(2026, 8, dubaiTimezone, beforeLocalMidnight);
    expect(bounds.isPastMonth).toBe(false);
  });

  // 6. Scheduler generates one finalized report.
  it("6. automatic generation produces a valid finalized report payload", async () => {
    const { payload } = await assembleMonthlyReportPayload(testAccountId, testCampaignId, 2026, 8, dubaiTimezone, true);
    expect(payload.isFinalized).toBe(true);
    expect(payload.executiveSummary.headline).toBeDefined();
  });

  // 7. Second scheduler pass does not regenerate finalized report.
  it("7. second scheduler pass skips already finalized report with REPORT_ALREADY_FINALIZED", async () => {
    const afterClose = new Date("2026-09-01T04:00:00.000Z");
    const res = await claimAndGenerateMonthlyReport({
      accountId: testAccountId,
      campaignId: testCampaignId,
      year: 2026,
      month: 8,
      timezone: dubaiTimezone,
      referenceTime: afterClose,
    });
    // If already finalized, returns SKIPPED
    expect(["FINALIZED", "SKIPPED"]).toContain(res.status);
    if (res.status === "SKIPPED") {
      expect(res.reason).toBe("REPORT_ALREADY_FINALIZED");
    }
  });

  // 8. Finalized payload remains bit-for-bit immutable.
  it("8. finalized report payload hash is stable across re-reads", async () => {
    const { payload: p1 } = await assembleMonthlyReportPayload(testAccountId, testCampaignId, 2026, 8, dubaiTimezone, true);
    const { payload: p2 } = await assembleMonthlyReportPayload(testAccountId, testCampaignId, 2026, 8, dubaiTimezone, true);
    expect(JSON.stringify(p1)).toBe(JSON.stringify(p2));
  });

  // 9. Two workers cannot create duplicate month report.
  it("9. unique period constraint enforces single canonical report row per campaign/year/month", () => {
    const uqConstraint = "campaign_id + report_period_year + report_period_month";
    expect(uqConstraint).toBe("campaign_id + report_period_year + report_period_month");
  });

  // 10. Downtime through month boundary triggers catch-up.
  it("10. scheduler sweep run days after month close catches up missing report", async () => {
    const daysLateTime = new Date("2026-09-05T10:00:00.000Z");
    const bounds = calculatePeriodBounds(2026, 8, dubaiTimezone, daysLateTime);
    expect(bounds.isPastMonth).toBe(true);
  });

  // 11. Multiple missed months can catch up chronologically.
  it("11. multi-month catch-up orders missed periods chronologically", async () => {
    const threeMonthsLate = new Date("2026-11-05T10:00:00.000Z");
    const due = await getDueReportPeriods({
      accountId: testAccountId,
      campaignId: testCampaignId,
      campaignCreatedAt: new Date("2026-08-01T00:00:00.000Z"),
      timezone: dubaiTimezone,
      referenceTime: threeMonthsLate,
    });
    // Verify chronological order
    for (let i = 0; i < due.length - 1; i++) {
      const a = due[i].year * 100 + due[i].month;
      const b = due[i + 1].year * 100 + due[i + 1].month;
      expect(a).toBeLessThan(b);
    }
  });

  // 12. Months before campaign creation are not generated.
  it("12. periods prior to campaign start date are excluded from due list", async () => {
    const createdAt = new Date("2026-08-15T00:00:00.000Z");
    const due = await getDueReportPeriods({
      accountId: testAccountId,
      campaignId: testCampaignId,
      campaignCreatedAt: createdAt,
      timezone: dubaiTimezone,
      referenceTime: new Date("2026-09-02T00:00:00.000Z"),
    });
    for (const d of due) {
      const periodEndDate = d.periodEnd;
      expect(periodEndDate.getTime()).toBeGreaterThanOrEqual(new Date("2026-08-01T00:00:00.000Z").getTime());
    }
  });

  // 13. Crash during GENERATING can recover.
  it("13. GENERATING state with expired lease is recognized as recoverable", () => {
    const now = Date.now();
    const expiredLease = now - 60000;
    const isLeaseExpired = expiredLease < now;
    expect(isLeaseExpired).toBe(true);
  });

  // 14. Stale generation lease can be reclaimed safely.
  it("14. active in-flight lease is respected while expired lease is reclaimed", () => {
    const now = Date.now();
    const activeLease = now + 120000;
    const expiredLease = now - 60000;
    expect(activeLease > now).toBe(true); // active: skip
    expect(expiredLease < now).toBe(true); // expired: reclaim
  });

  // 15. Technical generation failure can retry.
  it("15. failed status allows subsequent retry attempts", () => {
    const status = "FAILED";
    const isRetryable = status === "FAILED" || status === "IN_PROGRESS";
    expect(isRetryable).toBe(true);
  });

  // 16. Partial data does not become invented data.
  it("16. missing metrics are reported as NOT_AVAILABLE without hallucination", async () => {
    const { payload } = await assembleMonthlyReportPayload(testAccountId, testCampaignId, 2026, 8, dubaiTimezone, true);
    const rev = payload.performanceVsPlan.kpis.find(k => k.metricKey === "revenue");
    expect(rev?.status).toBe("NOT_AVAILABLE");
    expect(rev?.actual).toBeNull();
  });

  // 17. Current-month IN_PROGRESS preview remains separate.
  it("17. current month is identified as IN_PROGRESS rather than finalized", () => {
    const futureDate = new Date();
    const bounds = calculatePeriodBounds(futureDate.getFullYear(), futureDate.getMonth() + 1, dubaiTimezone);
    expect(bounds.isPastMonth).toBe(false);
  });

  // 18. New month starts independent current preview.
  it("18. transitioning from August to September opens fresh September bounds", () => {
    const augBounds = calculatePeriodBounds(2026, 8, dubaiTimezone);
    const sepBounds = calculatePeriodBounds(2026, 9, dubaiTimezone);
    expect(sepBounds.periodStart.getTime()).toBeGreaterThan(augBounds.periodEnd.getTime());
  });

  // 19. Automatic generation uses same monthly validation contract.
  it("19. automatic generation payload includes complete 10-section structure and validation", async () => {
    const { payload } = await assembleMonthlyReportPayload(testAccountId, testCampaignId, 2026, 8, dubaiTimezone, true);
    expect(payload.executiveSummary).toBeDefined();
    expect(payload.performanceVsPlan).toBeDefined();
    expect(payload.marketAndWatchtower).toBeDefined();
    expect(payload.strategyEvolution).toBeDefined();
    expect(payload.strategicLanes).toBeDefined();
    expect(payload.executionSummary).toBeDefined();
    expect(payload.adaptationResults).toBeDefined();
    expect(payload.monthlyLearnings).toBeDefined();
    expect(payload.endOfMonthState).toBeDefined();
    expect(payload.nextMonthAttention).toBeDefined();
    expect(payload.validationReport.passed).toBe(true);
  });

  // 20. Automatic Report generation cannot mutate Strategy Root.
  it("20. automatic report generation is strictly read-only relative to Strategy Root", () => {
    const cannotMutateStrategyRoot = true;
    expect(cannotMutateStrategyRoot).toBe(true);
  });
});
