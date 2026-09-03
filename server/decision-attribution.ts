import { db } from "./db";
import { strategyDecisions, decisionAttributions, calendarEntries } from "@shared/schema";
import { eq, and, desc, gte } from "drizzle-orm";

const CONTENT_TYPE_MAP: Record<string, string[]> = {
  creative_refresh: ["REEL", "POST", "CAROUSEL", "VIDEO", "STORY"],
  scaling: ["POST", "CAROUSEL", "REEL"],
  audience_optimization: ["POST", "CAROUSEL", "REEL"],
  campaign_management: ["REEL", "POST", "CAROUSEL", "VIDEO", "STORY"],
  bid_optimization: ["POST", "REEL"],
  pause: [],
  general: ["REEL", "POST", "CAROUSEL", "VIDEO", "STORY"],
};

function categorizeDecisionType(action: string): string {
  if (!action || typeof action !== 'string') return "general";
  const lower = action.toLowerCase();
  if (lower.includes("scale") || lower.includes("increase budget") || lower.includes("boost")) return "scaling";
  if (lower.includes("pause") || lower.includes("stop") || lower.includes("kill")) return "pause";
  if (lower.includes("refresh") || lower.includes("new creative") || lower.includes("new hook")) return "creative_refresh";
  if (lower.includes("audience") || lower.includes("targeting")) return "audience_optimization";
  if (lower.includes("campaign") || lower.includes("launch")) return "campaign_management";
  if (lower.includes("bid") || lower.includes("cpc") || lower.includes("cpm")) return "bid_optimization";
  return "general";
}

interface RelevanceResult {
  decisionId: string;
  relevanceScore: number;
  matchReason: string;
}

export function computeDecisionRelevance(
  decision: {
    id: string;
    action: string;
    campaignId: string | null;
    priority: string | null;
    executedAt: Date | null;
  },
  contentType: string,
  targetCampaignId: string,
  referenceTime: Date = new Date(),
): RelevanceResult {
  let score = 0;
  const reasons: string[] = [];

  const decisionType = categorizeDecisionType(decision.action);
  const matchingTypes = CONTENT_TYPE_MAP[decisionType] || [];
  const normalizedContent = contentType.toUpperCase();

  if (matchingTypes.includes(normalizedContent)) {
    score += 0.4;
    reasons.push(`type_match:${decisionType}→${normalizedContent}`);
  } else if (matchingTypes.length === 0) {
    reasons.push(`type_excluded:${decisionType}`);
  } else {
    score += 0.1;
    reasons.push(`type_partial:${decisionType}`);
  }

  if (decision.campaignId === targetCampaignId) {
    score += 0.3;
    reasons.push("campaign_match");
  }

  if (decision.executedAt) {
    const ageHours = (referenceTime.getTime() - decision.executedAt.getTime()) / (1000 * 60 * 60);
    if (ageHours <= 24) {
      score += 0.2;
      reasons.push("recency:<24h");
    } else if (ageHours <= 72) {
      score += 0.15;
      reasons.push("recency:<72h");
    } else if (ageHours <= 168) {
      score += 0.1;
      reasons.push("recency:<7d");
    } else {
      score += 0.05;
      reasons.push("recency:>7d");
    }
  }

  const prio = (decision.priority || "medium").toLowerCase();
  if (prio === "high" || prio === "critical") {
    score += 0.1;
    reasons.push(`priority:${prio}`);
  } else if (prio === "medium") {
    score += 0.05;
    reasons.push("priority:medium");
  }

  return {
    decisionId: decision.id,
    relevanceScore: Math.min(score, 1.0),
    matchReason: reasons.join("|"),
  };
}

function computeWeights(relevanceScores: number[]): number[] {
  const total = relevanceScores.reduce((sum, s) => sum + s, 0);
  if (total === 0) return relevanceScores.map(() => 1 / relevanceScores.length);
  return relevanceScores.map(s => Math.round((s / total) * 1000) / 1000);
}

export interface AttributionEntry {
  calendarEntryId: string;
  decisionId: string;
  weight: number;
  relevanceScore: number;
  attributionMethod: string;
  matchReason: string;
  accountId: string;
  campaignId: string;
}

export async function createAttributionEntries(
  calendarEntryIds: string[],
  contentType: string,
  campaignId: string,
  accountId: string,
): Promise<{ primaryDecisionId: string | null; attributionCount: number; method: string }> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const recentDecisions = await db.select()
    .from(strategyDecisions)
    .where(and(
      eq(strategyDecisions.accountId, accountId),
      eq(strategyDecisions.campaignId, campaignId),
      eq(strategyDecisions.status, "executed"),
      gte(strategyDecisions.executedAt, sevenDaysAgo),
    ))
    .orderBy(desc(strategyDecisions.executedAt))
    .limit(10);

  if (recentDecisions.length === 0) {
    console.log(`[Attribution] NO_DECISIONS | campaign=${campaignId} entries=${calendarEntryIds.length} method=fallback`);
    return { primaryDecisionId: null, attributionCount: 0, method: "fallback" };
  }

  const scored = recentDecisions.map(d => computeDecisionRelevance(
    { id: d.id, action: d.action, campaignId: d.campaignId, priority: d.priority, executedAt: d.executedAt },
    contentType,
    campaignId,
  ));

  scored.sort((a, b) => b.relevanceScore - a.relevanceScore);

  const MIN_RELEVANCE = 0.2;
  const relevant = scored.filter(s => s.relevanceScore >= MIN_RELEVANCE);

  if (relevant.length === 0) {
    const fallback = scored[0];
    const entries: AttributionEntry[] = calendarEntryIds.map(entryId => ({
      calendarEntryId: entryId,
      decisionId: fallback.decisionId,
      weight: 1.0,
      relevanceScore: fallback.relevanceScore,
      attributionMethod: "fallback",
      matchReason: fallback.matchReason,
      accountId,
      campaignId,
    }));

    if (entries.length > 0) {
      await db.insert(decisionAttributions).values(entries);
    }

    console.log(
      `[Attribution] FALLBACK | campaign=${campaignId} entries=${calendarEntryIds.length} ` +
      `primaryDecision=${fallback.decisionId} relevance=${fallback.relevanceScore.toFixed(3)} reason=${fallback.matchReason}`,
    );

    return { primaryDecisionId: fallback.decisionId, attributionCount: entries.length, method: "fallback" };
  }

  const MAX_ATTRIBUTIONS = 3;
  const topRelevant = relevant.slice(0, MAX_ATTRIBUTIONS);
  const weights = computeWeights(topRelevant.map(r => r.relevanceScore));
  const method = topRelevant.length === 1 ? "single" : "multi";

  const allEntries: AttributionEntry[] = [];

  for (const entryId of calendarEntryIds) {
    for (let i = 0; i < topRelevant.length; i++) {
      allEntries.push({
        calendarEntryId: entryId,
        decisionId: topRelevant[i].decisionId,
        weight: weights[i],
        relevanceScore: topRelevant[i].relevanceScore,
        attributionMethod: method,
        matchReason: topRelevant[i].matchReason,
        accountId,
        campaignId,
      });
    }
  }

  if (allEntries.length > 0) {
    await db.insert(decisionAttributions).values(allEntries);
  }

  const primaryDecisionId = topRelevant[0].decisionId;

  console.log(
    `[Attribution] ATTRIBUTION_DETAIL | campaign=${campaignId} entries=${calendarEntryIds.length} ` +
    `decisions=${topRelevant.length} method=${method} ` +
    `weights=[${weights.map(w => w.toFixed(3)).join(",")}] ` +
    `decisions=[${topRelevant.map(r => r.decisionId.slice(0, 8)).join(",")}] ` +
    `relevance=[${topRelevant.map(r => r.relevanceScore.toFixed(3)).join(",")}]`,
  );

  return { primaryDecisionId, attributionCount: allEntries.length, method };
}
