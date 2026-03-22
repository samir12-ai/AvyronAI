import { db } from "./db";
import { performanceSnapshots, baselineHistory, accountState } from "@shared/schema";
import { eq, desc, gte, sql, and } from "drizzle-orm";
import { logAudit } from "./audit";

export interface BaselineResult {
  rollingCpa: number;
  rollingRoas: number;
  rollingCtr: number;
  rollingSpend: number;
  driftDetected: boolean;
  driftSustainedCycles: number;
  driftDetails: {
    cpaDriftPercent: number;
    roasDriftPercent: number;
    ctrDriftPercent: number;
  };
}

export async function computeRollingBaselines(accountId: string): Promise<BaselineResult> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const recentData = await db.select({
    avgCpa: sql<number>`coalesce(avg(${performanceSnapshots.cpa}), 0)`,
    avgRoas: sql<number>`coalesce(avg(${performanceSnapshots.roas}), 0)`,
    avgCtr: sql<number>`coalesce(avg(${performanceSnapshots.ctr}), 0)`,
    totalSpend: sql<number>`coalesce(sum(${performanceSnapshots.spend}), 0)`,
  }).from(performanceSnapshots)
    .where(and(eq(performanceSnapshots.accountId, accountId), gte(performanceSnapshots.fetchedAt, sevenDaysAgo)));

  const currentCpa = Number(recentData[0]?.avgCpa) || 0;
  const currentRoas = Number(recentData[0]?.avgRoas) || 0;
  const currentCtr = Number(recentData[0]?.avgCtr) || 0;
  const currentSpend = Number(recentData[0]?.totalSpend) || 0;

  const previousBaselines = await db.select()
    .from(baselineHistory)
    .where(eq(baselineHistory.accountId, accountId))
    .orderBy(desc(baselineHistory.cycleTimestamp))
    .limit(3);

  let cpaDriftPercent = 0;
  let roasDriftPercent = 0;
  let ctrDriftPercent = 0;
  let driftSustainedCycles = 0;

  if (previousBaselines.length > 0) {
    const prev = previousBaselines[0];
    const prevCpa = prev.rollingCpa || 0;
    const prevRoas = prev.rollingRoas || 0;
    const prevCtr = prev.rollingCtr || 0;

    if (prevCpa > 0) cpaDriftPercent = Math.abs((currentCpa - prevCpa) / prevCpa) * 100;
    if (prevRoas > 0) roasDriftPercent = Math.abs((currentRoas - prevRoas) / prevRoas) * 100;
    if (prevCtr > 0) ctrDriftPercent = Math.abs((currentCtr - prevCtr) / prevCtr) * 100;

    const anyDrift = cpaDriftPercent > 15 || roasDriftPercent > 15 || ctrDriftPercent > 15;

    if (anyDrift) {
      driftSustainedCycles = (prev.driftSustainedCycles || 0) + 1;
    } else {
      driftSustainedCycles = 0;
    }
  }

  const driftDetected = driftSustainedCycles >= 3;

  await db.insert(baselineHistory).values({
    accountId,
    rollingCpa: currentCpa,
    rollingRoas: currentRoas,
    rollingCtr: currentCtr,
    rollingSpend: currentSpend,
    driftPercentCpa: cpaDriftPercent,
    driftPercentRoas: roasDriftPercent,
    driftPercentCtr: ctrDriftPercent,
    driftSustainedCycles,
  });

  await db.update(accountState)
    .set({
      driftFlag: driftDetected,
      updatedAt: new Date(),
    })
    .where(eq(accountState.accountId, accountId));

  if (driftDetected) {
    await logAudit(accountId, "DRIFT_DETECTED", {
      details: {
        cpaDriftPercent,
        roasDriftPercent,
        ctrDriftPercent,
        sustainedCycles: driftSustainedCycles,
      },
    });
  } else if (previousBaselines.length > 0 && (previousBaselines[0].driftSustainedCycles || 0) >= 3 && driftSustainedCycles < 3) {
    await logAudit(accountId, "DRIFT_CLEARED", {
      details: { sustainedCycles: driftSustainedCycles },
    });
  }

  return {
    rollingCpa: currentCpa,
    rollingRoas: currentRoas,
    rollingCtr: currentCtr,
    rollingSpend: currentSpend,
    driftDetected,
    driftSustainedCycles,
    driftDetails: {
      cpaDriftPercent,
      roasDriftPercent,
      ctrDriftPercent,
    },
  };
}
