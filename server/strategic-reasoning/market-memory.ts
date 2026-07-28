/**
 * Market Memory (P-4 Strategic Reasoning Layer)
 *
 * Long-term historical record of validated Watchtower Market Insights.
 * Every fresh validated insight (AI judge-approved OR deterministic summary
 * over real signal content) is stored here, deduped by the same signal-content
 * fingerprint the insight cache uses — unchanged market states never create
 * duplicate history rows.
 *
 * This module is the ONLY writer of market_memory. The Watchtower itself
 * stays focused on observation: it calls recordMarketInsight() as a
 * post-validation persistence hook and nothing more. All historical
 * comparison logic lives in the Strategic Reasoning Engine, which reads
 * exclusively from this store.
 */

import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "../db";
import { marketMemory, type MarketMemoryRow } from "../../shared/schema";
import type { MarketInsight, VerifiedSignalBundle } from "../watchtower/ai-market-analyst";

const LOG = "[MarketMemory]";

/** Theme snapshots stored as JSON — small, verified, deterministic values only. */
export interface StoredTheme {
  dimension: string;
  value: string;
  share: number;        // dominant: leaderShare · emerging/declining: currentShare
  deltaPp: number | null;
  confidence?: string;  // dominant themes only
}

function deriveConfidence(bundle: VerifiedSignalBundle): "high" | "medium" | "low" {
  if (bundle.dataStatus !== "ok") return "low";
  const highDominants = bundle.dominantPatterns.filter((d) => d.confidence === "high").length;
  return highDominants >= 2 ? "high" : "medium";
}

/**
 * Persist a validated market insight. Returns the memory row id, or null when
 * this exact signal state (fingerprint) is already stored for this
 * campaign+window. Insufficient-data summaries are never stored — they
 * describe absence of market structure, not market history.
 */
export async function recordMarketInsight(args: {
  campaignId: string;
  accountId: string;
  fingerprint: string;
  insight: MarketInsight;
  bundle: VerifiedSignalBundle;
}): Promise<string | null> {
  const { campaignId, accountId, fingerprint, insight, bundle } = args;
  if (bundle.dataStatus === "insufficient") return null;

  const dominantThemes: StoredTheme[] = bundle.dominantPatterns.map((d) => ({
    dimension: d.dimension,
    value: d.leader,
    share: d.leaderShare,
    deltaPp: d.trend === "insufficient_history" ? null : d.trendDeltaPp,
    confidence: d.confidence,
  }));
  const emergingThemes: StoredTheme[] = bundle.emergingPatterns.map((p) => ({
    dimension: p.dimension,
    value: p.value,
    share: p.currentShare,
    deltaPp: p.deltaPp,
  }));
  const decliningThemes: StoredTheme[] = bundle.decliningPatterns.map((p) => ({
    dimension: p.dimension,
    value: p.value,
    share: p.currentShare,
    deltaPp: p.deltaPp,
  }));

  const inserted = await db
    .insert(marketMemory)
    .values({
      accountId,
      campaignId,
      windowDays: bundle.windowDays,
      windowFrom: new Date(bundle.currentWindow.from),
      windowTo: new Date(bundle.currentWindow.to),
      fingerprint,
      source: insight.source,
      headline: insight.headline,
      narrative: insight.narrative,
      signalGroups: JSON.stringify(insight.signalGroups),
      dominantThemes: JSON.stringify(dominantThemes),
      emergingThemes: JSON.stringify(emergingThemes),
      decliningThemes: JSON.stringify(decliningThemes),
      confirmedShifts: JSON.stringify(bundle.confirmedShifts),
      confidence: deriveConfidence(bundle),
      dataStatus: bundle.dataStatus,
      basedOn: JSON.stringify(insight.basedOn),
    })
    .onConflictDoNothing({
      target: [marketMemory.accountId, marketMemory.campaignId, marketMemory.windowDays, marketMemory.fingerprint],
    })
    .returning({ id: marketMemory.id });

  if (inserted.length === 0) {
    return null; // fingerprint already stored — market state unchanged
  }
  console.log(
    `${LOG} STORED campaign=${campaignId} window=${bundle.windowDays}d source=${insight.source} id=${inserted[0].id}`,
  );
  return inserted[0].id;
}

/**
 * Read historical memory for a campaign, newest first. Always account-scoped
 * (tenant isolation). monthsBack bounds the comparison horizon (brief:
 * recurring behavior over ~12 months).
 */
export async function getMarketMemoryRows(
  campaignId: string,
  accountId: string,
  opts: { windowDays?: number; monthsBack?: number; limit?: number } = {},
): Promise<MarketMemoryRow[]> {
  const monthsBack = opts.monthsBack ?? 12;
  const since = new Date(Date.now() - monthsBack * 30 * 86400000);
  const conditions = [
    eq(marketMemory.accountId, accountId),
    eq(marketMemory.campaignId, campaignId),
    gte(marketMemory.createdAt, since),
    ...(opts.windowDays !== undefined ? [eq(marketMemory.windowDays, opts.windowDays)] : []),
  ];
  return db
    .select()
    .from(marketMemory)
    .where(and(...conditions))
    .orderBy(desc(marketMemory.createdAt))
    .limit(opts.limit ?? 50);
}
