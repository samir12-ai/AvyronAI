import { db } from "./db";
import { decisionOutcomes, performanceSnapshots, strategyDecisions, strategyMemory } from "@shared/schema";
import { eq, sql, gte, desc, and } from "drizzle-orm";
import { logAudit } from "./audit";
export async function snapshotPreMetrics(decisionId, accountId, decisionType) {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const metricsResult = await db.select({
        avgCpa: sql `coalesce(avg(${performanceSnapshots.cpa}), 0)`,
        avgRoas: sql `coalesce(avg(${performanceSnapshots.roas}), 0)`,
        avgCtr: sql `coalesce(avg(${performanceSnapshots.ctr}), 0)`,
        totalSpend: sql `coalesce(sum(${performanceSnapshots.spend}), 0)`,
    }).from(performanceSnapshots)
        .where(and(eq(performanceSnapshots.accountId, accountId), gte(performanceSnapshots.fetchedAt, oneDayAgo)));
    const m = metricsResult[0];
    await db.insert(decisionOutcomes).values({
        decisionId,
        accountId,
        decisionType: decisionType || "unknown",
        preMetricsCpa: Number(m?.avgCpa) || 0,
        preMetricsRoas: Number(m?.avgRoas) || 0,
        preMetricsCtr: Number(m?.avgCtr) || 0,
        preMetricsSpend: Number(m?.totalSpend) || 0,
    });
}
export async function evaluatePendingOutcomes(accountId) {
    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const pending = await db.select()
        .from(decisionOutcomes)
        .where(sql `${decisionOutcomes.accountId} = ${accountId} 
          AND ${decisionOutcomes.outcome} IS NULL 
          AND ${decisionOutcomes.executedAt} <= ${fortyEightHoursAgo}`)
        .limit(20);
    if (pending.length === 0)
        return;
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const currentMetrics = await db.select({
        avgCpa: sql `coalesce(avg(${performanceSnapshots.cpa}), 0)`,
        avgRoas: sql `coalesce(avg(${performanceSnapshots.roas}), 0)`,
        avgCtr: sql `coalesce(avg(${performanceSnapshots.ctr}), 0)`,
        totalSpend: sql `coalesce(sum(${performanceSnapshots.spend}), 0)`,
    }).from(performanceSnapshots)
        .where(and(eq(performanceSnapshots.accountId, accountId), gte(performanceSnapshots.fetchedAt, oneDayAgo)));
    const current = currentMetrics[0];
    const postCpa = Number(current?.avgCpa) || 0;
    const postRoas = Number(current?.avgRoas) || 0;
    const postCtr = Number(current?.avgCtr) || 0;
    const postSpend = Number(current?.totalSpend) || 0;
    for (const p of pending) {
        const preCpa = p.preMetricsCpa || 0;
        const preRoas = p.preMetricsRoas || 0;
        const preCtr = p.preMetricsCtr || 0;
        let outcome = "neutral";
        const cpaChange = preCpa > 0 ? ((postCpa - preCpa) / preCpa) * 100 : 0;
        const roasChange = preRoas > 0 ? ((postRoas - preRoas) / preRoas) * 100 : 0;
        const ctrChange = preCtr > 0 ? ((postCtr - preCtr) / preCtr) * 100 : 0;
        const improved = (cpaChange < -5) || (roasChange > 5) || (ctrChange > 5);
        const worsened = (cpaChange > 10) || (roasChange < -10) || (ctrChange < -10);
        if (improved && !worsened) {
            outcome = "success";
        }
        else if (worsened && !improved) {
            outcome = "failure";
        }
        else {
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
            const score = outcome === "success" ? 1.0 : outcome === "failure" ? -1.0 : 0.0;
            const isWinner = outcome === "success";
            await db.update(strategyMemory)
                .set({ score, isWinner, updatedAt: new Date() })
                .where(eq(strategyMemory.id, p.decisionId));
        }
        catch {
            // strategy_memory row may not exist for this decisionId — not an error
        }
        await logAudit(accountId, "OUTCOME_EVALUATED", {
            decisionId: p.decisionId,
            details: {
                outcome,
                cpaChange: cpaChange.toFixed(1) + "%",
                roasChange: roasChange.toFixed(1) + "%",
                ctrChange: ctrChange.toFixed(1) + "%",
            },
            preMetrics: { cpa: preCpa, roas: preRoas, ctr: preCtr },
            postMetrics: { cpa: postCpa, roas: postRoas, ctr: postCtr },
        });
    }
}
export async function computeSuccessRates(accountId) {
    const outcomes = await db.select()
        .from(decisionOutcomes)
        .where(sql `${decisionOutcomes.accountId} = ${accountId} AND ${decisionOutcomes.outcome} IS NOT NULL`)
        .orderBy(desc(decisionOutcomes.evaluatedAt))
        .limit(50);
    const rates = {};
    for (const o of outcomes) {
        const type = o.decisionType || "unknown";
        if (!rates[type])
            rates[type] = { total: 0, successes: 0, successRate: 0 };
        rates[type].total++;
        if (o.outcome === "success")
            rates[type].successes++;
    }
    const result = {};
    for (const [type, data] of Object.entries(rates)) {
        result[type] = {
            total: data.total,
            successRate: data.total > 0 ? (data.successes / data.total) * 100 : 0,
        };
    }
    return result;
}
export async function getRecentOutcomesForPrompt(accountId) {
    const outcomes = await db.select({
        decisionType: decisionOutcomes.decisionType,
        outcome: decisionOutcomes.outcome,
        preCpa: decisionOutcomes.preMetricsCpa,
        postCpa: decisionOutcomes.postMetricsCpa,
        preRoas: decisionOutcomes.preMetricsRoas,
        postRoas: decisionOutcomes.postMetricsRoas,
    })
        .from(decisionOutcomes)
        .where(sql `${decisionOutcomes.accountId} = ${accountId} AND ${decisionOutcomes.outcome} IS NOT NULL`)
        .orderBy(desc(decisionOutcomes.evaluatedAt))
        .limit(20);
    if (outcomes.length === 0)
        return "No previous decision outcomes available yet.";
    const rates = await computeSuccessRates(accountId);
    const ratesStr = Object.entries(rates)
        .map(([type, data]) => `${type}: ${data.successRate.toFixed(0)}% success (${data.total} decisions)`)
        .join(", ");
    const outcomesSummary = outcomes
        .map(o => `${o.decisionType}: ${o.outcome} (CPA: ${o.preCpa?.toFixed(2)}→${o.postCpa?.toFixed(2)}, ROAS: ${o.preRoas?.toFixed(2)}→${o.postRoas?.toFixed(2)})`)
        .join("\n");
    return `DECISION OUTCOME HISTORY (last 20):\n${outcomesSummary}\n\nSUCCESS RATES BY TYPE: ${ratesStr}\n\nIMPORTANT: If any decision type has success rate below 40%, avoid auto-executing that type. Reduce aggressiveness for types with declining success rates.`;
}
