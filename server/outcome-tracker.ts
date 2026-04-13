import { db } from "./db";
import { decisionOutcomes, performanceSnapshots, strategyDecisions, strategyMemory, calendarEntries, studioItems, publishedPosts } from "@shared/schema";
import { eq, sql, gte, isNull, isNotNull, lte, desc, and, inArray } from "drizzle-orm";
import { logAudit } from "./audit";
import { validateDecisionForMemoryWrite } from "./decision-policy";

export interface ActionMetrics {
  avgCpa: number;
  avgRoas: number;
  avgCtr: number;
  totalSpend: number;
  actionCount: number;
  publishedCount: number;
  snapshotCount: number;
}

export async function getActionPerformance(decisionId: string, accountId: string): Promise<ActionMetrics | null> {
  const linkedEntries = await db.select({ id: calendarEntries.id })
    .from(calendarEntries)
    .where(and(
      eq(calendarEntries.sourceDecisionId, decisionId),
      eq(calendarEntries.accountId, accountId),
    ));

  if (linkedEntries.length === 0) return null;

  const entryIds = linkedEntries.map(e => e.id);

  const linkedStudio = await db.select({ id: studioItems.id })
    .from(studioItems)
    .where(and(
      inArray(studioItems.calendarEntryId, entryIds),
      eq(studioItems.accountId, accountId),
    ));

  if (linkedStudio.length === 0) {
    return {
      avgCpa: 0, avgRoas: 0, avgCtr: 0, totalSpend: 0,
      actionCount: linkedEntries.length, publishedCount: 0, snapshotCount: 0,
    };
  }

  const studioIds = linkedStudio.map(s => s.id);

  const linkedPublished = await db.select({ metaPostId: publishedPosts.metaPostId })
    .from(publishedPosts)
    .where(and(
      inArray(publishedPosts.mediaItemId, studioIds),
      eq(publishedPosts.accountId, accountId),
      isNotNull(publishedPosts.metaPostId),
    ));

  const metaPostIds = linkedPublished.map(p => p.metaPostId).filter((id): id is string => !!id);

  if (metaPostIds.length === 0) {
    return {
      avgCpa: 0, avgRoas: 0, avgCtr: 0, totalSpend: 0,
      actionCount: linkedEntries.length, publishedCount: linkedPublished.length, snapshotCount: 0,
    };
  }

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const snapshots = await db.select({
    avgCpa: sql<number>`coalesce(avg(${performanceSnapshots.cpa}), 0)`,
    avgRoas: sql<number>`coalesce(avg(${performanceSnapshots.roas}), 0)`,
    avgCtr: sql<number>`coalesce(avg(${performanceSnapshots.ctr}), 0)`,
    totalSpend: sql<number>`coalesce(sum(${performanceSnapshots.spend}), 0)`,
    cnt: sql<number>`count(*)`,
  }).from(performanceSnapshots)
    .where(and(
      eq(performanceSnapshots.accountId, accountId),
      inArray(performanceSnapshots.postId, metaPostIds),
      gte(performanceSnapshots.fetchedAt, oneDayAgo),
    ));

  const s = snapshots[0];
  const snapshotCount = Number(s?.cnt) || 0;

  if (snapshotCount === 0) {
    return {
      avgCpa: 0, avgRoas: 0, avgCtr: 0, totalSpend: 0,
      actionCount: linkedEntries.length, publishedCount: metaPostIds.length, snapshotCount: 0,
    };
  }

  return {
    avgCpa: Number(s?.avgCpa) || 0,
    avgRoas: Number(s?.avgRoas) || 0,
    avgCtr: Number(s?.avgCtr) || 0,
    totalSpend: Number(s?.totalSpend) || 0,
    actionCount: linkedEntries.length,
    publishedCount: metaPostIds.length,
    snapshotCount,
  };
}

export async function snapshotPreMetrics(decisionId: string, accountId: string, decisionType?: string, campaignId?: string) {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const conditions = [
    eq(performanceSnapshots.accountId, accountId),
    gte(performanceSnapshots.fetchedAt, oneDayAgo),
  ];
  if (campaignId) {
    conditions.push(eq(performanceSnapshots.campaignId, campaignId));
  }

  const metricsResult = await db.select({
    avgCpa: sql<number>`coalesce(avg(${performanceSnapshots.cpa}), 0)`,
    avgRoas: sql<number>`coalesce(avg(${performanceSnapshots.roas}), 0)`,
    avgCtr: sql<number>`coalesce(avg(${performanceSnapshots.ctr}), 0)`,
    totalSpend: sql<number>`coalesce(sum(${performanceSnapshots.spend}), 0)`,
  }).from(performanceSnapshots)
    .where(and(...conditions));

  const m = metricsResult[0];

  await db.insert(decisionOutcomes).values({
    decisionId,
    accountId,
    campaignId: campaignId || null,
    decisionType: decisionType || "unknown",
    preMetricsCpa: Number(m?.avgCpa) || 0,
    preMetricsRoas: Number(m?.avgRoas) || 0,
    preMetricsCtr: Number(m?.avgCtr) || 0,
    preMetricsSpend: Number(m?.totalSpend) || 0,
  });

  console.log(
    `[OutcomeTracker] SNAPSHOT_PRE_METRICS | decision=${decisionId} account=${accountId} ` +
    `campaign=${campaignId || "NONE"} scope=${campaignId ? "campaign" : "account"} ` +
    `cpa=${Number(m?.avgCpa || 0).toFixed(2)} roas=${Number(m?.avgRoas || 0).toFixed(2)} ctr=${Number(m?.avgCtr || 0).toFixed(4)}`,
  );
}

export async function evaluatePendingOutcomes(accountId: string) {
  const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);

  const pending = await db.select()
    .from(decisionOutcomes)
    .where(
      sql`${decisionOutcomes.accountId} = ${accountId} 
          AND ${decisionOutcomes.outcome} IS NULL 
          AND ${decisionOutcomes.executedAt} <= ${fortyEightHoursAgo}`
    )
    .limit(20);

  if (pending.length === 0) return;

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const campaignMetricsCache = new Map<string, { avgCpa: number; avgRoas: number; avgCtr: number; totalSpend: number }>();

  async function getMetricsForScope(campaignId: string | null): Promise<{ avgCpa: number; avgRoas: number; avgCtr: number; totalSpend: number }> {
    const cacheKey = campaignId || "__account__";
    if (campaignMetricsCache.has(cacheKey)) return campaignMetricsCache.get(cacheKey)!;

    const conditions = [
      eq(performanceSnapshots.accountId, accountId),
      gte(performanceSnapshots.fetchedAt, oneDayAgo),
    ];
    if (campaignId) {
      conditions.push(eq(performanceSnapshots.campaignId, campaignId));
    }

    const result = await db.select({
      avgCpa: sql<number>`coalesce(avg(${performanceSnapshots.cpa}), 0)`,
      avgRoas: sql<number>`coalesce(avg(${performanceSnapshots.roas}), 0)`,
      avgCtr: sql<number>`coalesce(avg(${performanceSnapshots.ctr}), 0)`,
      totalSpend: sql<number>`coalesce(sum(${performanceSnapshots.spend}), 0)`,
    }).from(performanceSnapshots)
      .where(and(...conditions));

    const m = result[0];
    const metrics = {
      avgCpa: Number(m?.avgCpa) || 0,
      avgRoas: Number(m?.avgRoas) || 0,
      avgCtr: Number(m?.avgCtr) || 0,
      totalSpend: Number(m?.totalSpend) || 0,
    };
    campaignMetricsCache.set(cacheKey, metrics);
    return metrics;
  }

  for (const p of pending) {
    const scopeCampaignId = p.campaignId || null;

    let postCpa: number;
    let postRoas: number;
    let postCtr: number;
    let postSpend: number;
    let measurementScope: "action" | "campaign" | "account";

    const actionMetrics = await getActionPerformance(p.decisionId, accountId);
    if (actionMetrics && actionMetrics.snapshotCount > 0) {
      postCpa = actionMetrics.avgCpa;
      postRoas = actionMetrics.avgRoas;
      postCtr = actionMetrics.avgCtr;
      postSpend = actionMetrics.totalSpend;
      measurementScope = "action";
    } else {
      const current = await getMetricsForScope(scopeCampaignId);
      postCpa = current.avgCpa;
      postRoas = current.avgRoas;
      postCtr = current.avgCtr;
      postSpend = current.totalSpend;
      measurementScope = scopeCampaignId ? "campaign" : "account";
    }

    const preCpa = p.preMetricsCpa || 0;
    const preRoas = p.preMetricsRoas || 0;
    const preCtr = p.preMetricsCtr || 0;

    let outcome: "success" | "neutral" | "failure" = "neutral";

    const cpaChange = preCpa > 0 ? ((postCpa - preCpa) / preCpa) * 100 : 0;
    const roasChange = preRoas > 0 ? ((postRoas - preRoas) / preRoas) * 100 : 0;
    const ctrChange = preCtr > 0 ? ((postCtr - preCtr) / preCtr) * 100 : 0;

    const improved = (cpaChange < -5) || (roasChange > 5) || (ctrChange > 5);
    const worsened = (cpaChange > 10) || (roasChange < -10) || (ctrChange < -10);

    if (improved && !worsened) {
      outcome = "success";
    } else if (worsened && !improved) {
      outcome = "failure";
    } else {
      outcome = "neutral";
    }

    await db.update(decisionOutcomes)
      .set({
        postMetricsCpa: postCpa,
        postMetricsRoas: postRoas,
        postMetricsCtr: postCtr,
        postMetricsSpend: postSpend,
        outcome,
        evaluatedAt: new Date(),
      })
      .where(eq(decisionOutcomes.id, p.id));

    await db.update(strategyDecisions)
      .set({ outcomeStatus: outcome })
      .where(eq(strategyDecisions.id, p.decisionId));

    try {
      const direction = outcome === "success" ? "reinforce" as const
        : (outcome === "failure" ? "avoid" as const : "neutral" as const);
      const confidenceScore = outcome === "success" ? 0.85
        : (outcome === "failure" ? 0.15 : 0.5);

      const validation = validateDecisionForMemoryWrite(confidenceScore, direction, "outcome-tracker");
      if (!validation.allowed) {
        console.log(
          `[OutcomeTracker] MEMORY_UPDATE_BLOCKED | decision=${p.decisionId} outcome=${outcome} ` +
          `confidence=${confidenceScore} reason="${validation.reason}"`,
        );
      } else {
        const score = outcome === "success" ? 1.0 : outcome === "failure" ? -1.0 : 0.0;
        const isWinner = outcome === "success";
        await db.update(strategyMemory)
          .set({ score, isWinner, confidenceScore, direction, lastValidatedAt: new Date(), updatedAt: new Date() })
          .where(eq(strategyMemory.id, p.decisionId));
      }
    } catch {
    }

    await logAudit(accountId, "OUTCOME_EVALUATED", {
      decisionId: p.decisionId,
      details: {
        outcome,
        measurementScope,
        campaignId: scopeCampaignId || "account-wide",
        cpaChange: cpaChange.toFixed(1) + "%",
        roasChange: roasChange.toFixed(1) + "%",
        ctrChange: ctrChange.toFixed(1) + "%",
        actionMetrics: actionMetrics ? {
          actionCount: actionMetrics.actionCount,
          publishedCount: actionMetrics.publishedCount,
          snapshotCount: actionMetrics.snapshotCount,
        } : null,
      },
      preMetrics: { cpa: preCpa, roas: preRoas, ctr: preCtr },
      postMetrics: { cpa: postCpa, roas: postRoas, ctr: postCtr },
    });

    console.log(
      `[OutcomeTracker] OUTCOME_SCOPE=${measurementScope} | decision=${p.decisionId} type=${p.decisionType} ` +
      `campaign=${scopeCampaignId || "N/A"} outcome=${outcome} ` +
      `cpa=${cpaChange.toFixed(1)}% roas=${roasChange.toFixed(1)}% ctr=${ctrChange.toFixed(1)}%` +
      (actionMetrics ? ` actions=${actionMetrics.actionCount} published=${actionMetrics.publishedCount} snapshots=${actionMetrics.snapshotCount}` : ""),
    );
  }
}

export async function computeSuccessRates(accountId: string): Promise<Record<string, { total: number; successRate: number }>> {
  const outcomes = await db.select()
    .from(decisionOutcomes)
    .where(
      sql`${decisionOutcomes.accountId} = ${accountId} AND ${decisionOutcomes.outcome} IS NOT NULL`
    )
    .orderBy(desc(decisionOutcomes.evaluatedAt))
    .limit(50);

  const rates: Record<string, { total: number; successes: number; successRate: number }> = {};

  for (const o of outcomes) {
    const type = o.decisionType || "unknown";
    if (!rates[type]) rates[type] = { total: 0, successes: 0, successRate: 0 };
    rates[type].total++;
    if (o.outcome === "success") rates[type].successes++;
  }

  const result: Record<string, { total: number; successRate: number }> = {};
  for (const [type, data] of Object.entries(rates)) {
    result[type] = {
      total: data.total,
      successRate: data.total > 0 ? (data.successes / data.total) * 100 : 0,
    };
  }

  return result;
}

export async function getRecentOutcomesForPrompt(accountId: string): Promise<string> {
  const outcomes = await db.select({
    decisionType: decisionOutcomes.decisionType,
    outcome: decisionOutcomes.outcome,
    campaignId: decisionOutcomes.campaignId,
    preCpa: decisionOutcomes.preMetricsCpa,
    postCpa: decisionOutcomes.postMetricsCpa,
    preRoas: decisionOutcomes.preMetricsRoas,
    postRoas: decisionOutcomes.postMetricsRoas,
  })
    .from(decisionOutcomes)
    .where(
      sql`${decisionOutcomes.accountId} = ${accountId} AND ${decisionOutcomes.outcome} IS NOT NULL`
    )
    .orderBy(desc(decisionOutcomes.evaluatedAt))
    .limit(20);

  if (outcomes.length === 0) return "No previous decision outcomes available yet.";

  const rates = await computeSuccessRates(accountId);
  const ratesStr = Object.entries(rates)
    .map(([type, data]) => `${type}: ${data.successRate.toFixed(0)}% success (${data.total} decisions)`)
    .join(", ");

  const outcomesSummary = outcomes
    .map(o => `${o.decisionType}: ${o.outcome} [campaign=${o.campaignId || "unknown"}] (CPA: ${o.preCpa?.toFixed(2)}→${o.postCpa?.toFixed(2)}, ROAS: ${o.preRoas?.toFixed(2)}→${o.postRoas?.toFixed(2)})`)
    .join("\n");

  return `DECISION OUTCOME HISTORY (last 20):\n${outcomesSummary}\n\nSUCCESS RATES BY TYPE: ${ratesStr}\n\nIMPORTANT: If any decision type has success rate below 40%, avoid auto-executing that type. Reduce aggressiveness for types with declining success rates.`;
}

