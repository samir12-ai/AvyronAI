import { db } from "../db";
import { dataSourceTransitions } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import type { StatisticalValidityResult } from "./statistical-validity";

export interface ModeTransitionEntry {
  timestamp: string;
  campaignId: string;
  accountId: string;
  previousMode: "benchmark" | "campaign_metrics";
  newMode: "benchmark" | "campaign_metrics";
  transitionReason: string;
  statisticalEvidence: StatisticalValidityResult;
  triggeredBy: "adaptive_switch" | "manual" | "validation_fallback";
}

export async function logModeTransition(entry: ModeTransitionEntry): Promise<void> {
  try {
    const latest = await getLatestTransition(entry.campaignId, entry.accountId);
    if (latest && latest.previousMode === entry.previousMode && latest.newMode === entry.newMode && entry.triggeredBy === "adaptive_switch") {
      return;
    }

    await db.insert(dataSourceTransitions).values({
      accountId: entry.accountId,
      campaignId: entry.campaignId,
      previousMode: entry.previousMode,
      newMode: entry.newMode,
      transitionReason: entry.transitionReason,
      triggeredBy: entry.triggeredBy,
      statisticalEvidence: JSON.stringify(entry.statisticalEvidence),
    });

    console.log(
      `[DataSource:TransitionLog] ${entry.previousMode} → ${entry.newMode} | ` +
      `campaign=${entry.campaignId} | trigger=${entry.triggeredBy} | ` +
      `reason=${entry.transitionReason} | ` +
      `conversions=${entry.statisticalEvidence.conversions} | ` +
      `spend=$${entry.statisticalEvidence.spend.toFixed(2)} | ` +
      `confidence=${(entry.statisticalEvidence.confidenceLevel * 100).toFixed(0)}%`
    );
  } catch (error) {
    console.error("[DataSource:TransitionLog] Failed to persist transition:", error);
  }
}

function mapRow(row: any) {
  return {
    id: row.id,
    timestamp: row.createdAt?.toISOString() || "",
    campaignId: row.campaignId,
    accountId: row.accountId,
    previousMode: row.previousMode,
    newMode: row.newMode,
    transitionReason: row.transitionReason,
    triggeredBy: row.triggeredBy,
    statisticalEvidence: row.statisticalEvidence ? JSON.parse(row.statisticalEvidence) : null,
  };
}

export async function getTransitionLog(campaignId?: string, accountId: string = "default", limit: number = 50): Promise<any[]> {
  try {
    const conditions = [eq(dataSourceTransitions.accountId, accountId)];
    if (campaignId) {
      conditions.push(eq(dataSourceTransitions.campaignId, campaignId));
    }

    const rows = await db.select().from(dataSourceTransitions)
      .where(and(...conditions))
      .orderBy(desc(dataSourceTransitions.createdAt))
      .limit(limit);

    return rows.map(mapRow);
  } catch (error) {
    console.error("[DataSource:TransitionLog] Failed to fetch transitions:", error);
    return [];
  }
}

export async function getLatestTransition(campaignId: string, accountId: string = "default"): Promise<any | null> {
  try {
    const [row] = await db.select().from(dataSourceTransitions)
      .where(and(
        eq(dataSourceTransitions.campaignId, campaignId),
        eq(dataSourceTransitions.accountId, accountId),
      ))
      .orderBy(desc(dataSourceTransitions.createdAt))
      .limit(1);

    if (!row) return null;
    return mapRow(row);
  } catch (error) {
    console.error("[DataSource:TransitionLog] Failed to fetch latest transition:", error);
    return null;
  }
}
