import { db } from "./db";
import {
  miSnapshots,
  audienceSnapshots,
  positioningSnapshots,
  differentiationSnapshots,
  offerSnapshots,
  funnelSnapshots,
  integritySnapshots,
  awarenessSnapshots,
  persuasionSnapshots,
  strategyValidationSnapshots,
  budgetGovernorSnapshots,
  channelSelectionSnapshots,
  iterationSnapshots,
  retentionSnapshots,
  performanceSnapshots,
  ciSnapshots,
  growthCampaigns,
} from "@shared/schema";
import { eq, lt, sql, notInArray, inArray } from "drizzle-orm";
import { logAudit } from "./audit";

const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MAX_RETENTION_DAYS = 90;
const MAX_SNAPSHOTS_PER_CAMPAIGN = 20;

let cleanupTimer: ReturnType<typeof setInterval> | null = null;
let initialTimeout: ReturnType<typeof setTimeout> | null = null;

interface SnapshotTableConfig {
  name: string;
  table: any;
  timestampColumn: "createdAt" | "fetchedAt";
  campaignScoped: boolean;
}

const SNAPSHOT_TABLES: SnapshotTableConfig[] = [
  { name: "mi_snapshots", table: miSnapshots, timestampColumn: "createdAt", campaignScoped: true },
  { name: "audience_snapshots", table: audienceSnapshots, timestampColumn: "createdAt", campaignScoped: true },
  { name: "positioning_snapshots", table: positioningSnapshots, timestampColumn: "createdAt", campaignScoped: true },
  { name: "differentiation_snapshots", table: differentiationSnapshots, timestampColumn: "createdAt", campaignScoped: true },
  { name: "offer_snapshots", table: offerSnapshots, timestampColumn: "createdAt", campaignScoped: true },
  { name: "funnel_snapshots", table: funnelSnapshots, timestampColumn: "createdAt", campaignScoped: true },
  { name: "integrity_snapshots", table: integritySnapshots, timestampColumn: "createdAt", campaignScoped: true },
  { name: "awareness_snapshots", table: awarenessSnapshots, timestampColumn: "createdAt", campaignScoped: true },
  { name: "persuasion_snapshots", table: persuasionSnapshots, timestampColumn: "createdAt", campaignScoped: true },
  { name: "strategy_validation_snapshots", table: strategyValidationSnapshots, timestampColumn: "createdAt", campaignScoped: true },
  { name: "budget_governor_snapshots", table: budgetGovernorSnapshots, timestampColumn: "createdAt", campaignScoped: true },
  { name: "channel_selection_snapshots", table: channelSelectionSnapshots, timestampColumn: "createdAt", campaignScoped: true },
  { name: "iteration_snapshots", table: iterationSnapshots, timestampColumn: "createdAt", campaignScoped: true },
  { name: "retention_snapshots", table: retentionSnapshots, timestampColumn: "createdAt", campaignScoped: true },
  { name: "performance_snapshots", table: performanceSnapshots, timestampColumn: "fetchedAt", campaignScoped: false },
  { name: "ci_snapshots", table: ciSnapshots, timestampColumn: "createdAt", campaignScoped: false },
];

function getTimestampCol(config: SnapshotTableConfig) {
  return config.timestampColumn === "fetchedAt" ? config.table.fetchedAt : config.table.createdAt;
}

async function purgeExpiredSnapshots(): Promise<{ table: string; deleted: number }[]> {
  const cutoffDate = new Date(Date.now() - MAX_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const results: { table: string; deleted: number }[] = [];

  for (const config of SNAPSHOT_TABLES) {
    try {
      const tsCol = getTimestampCol(config);
      const expired = await db
        .delete(config.table)
        .where(lt(tsCol, cutoffDate))
        .returning({ id: config.table.id });

      if (expired.length > 0) {
        results.push({ table: config.name, deleted: expired.length });
        console.log(`[SnapshotCleanup] TIME_PURGE | ${config.name} | deleted=${expired.length} | cutoff=${cutoffDate.toISOString()}`);
      }
    } catch (err: any) {
      console.error(`[SnapshotCleanup] TIME_PURGE_ERROR | ${config.name} | ${err.message}`);
    }
  }

  return results;
}

async function enforcePerCampaignCap(): Promise<{ table: string; campaign: string; deleted: number }[]> {
  const results: { table: string; campaign: string; deleted: number }[] = [];

  const campaignScopedTables = SNAPSHOT_TABLES.filter(c => c.campaignScoped);

  for (const config of campaignScopedTables) {
    try {
      const tsCol = getTimestampCol(config);
      const campaigns: { campaignId: string; count: number }[] = await db
        .select({
          campaignId: config.table.campaignId,
          count: sql<number>`count(*)::int`,
        })
        .from(config.table)
        .groupBy(config.table.campaignId)
        .having(sql`count(*) > ${MAX_SNAPSHOTS_PER_CAMPAIGN}`);

      for (const { campaignId, count } of campaigns) {
        const excess = count - MAX_SNAPSHOTS_PER_CAMPAIGN;
        const toDelete = await db
          .select({ id: config.table.id })
          .from(config.table)
          .where(eq(config.table.campaignId, campaignId))
          .orderBy(sql`${tsCol} ASC`)
          .limit(excess);

        if (toDelete.length > 0) {
          const ids = toDelete.map((r: any) => r.id);
          await db.delete(config.table).where(inArray(config.table.id, ids));
          results.push({ table: config.name, campaign: campaignId, deleted: ids.length });
          console.log(`[SnapshotCleanup] CAP_ENFORCE | ${config.name} | campaign=${campaignId} | deleted=${ids.length} | was=${count} | cap=${MAX_SNAPSHOTS_PER_CAMPAIGN}`);
        }
      }
    } catch (err: any) {
      console.error(`[SnapshotCleanup] CAP_ENFORCE_ERROR | ${config.name} | ${err.message}`);
    }
  }

  return results;
}

async function purgeOrphanedSnapshots(): Promise<{ table: string; deleted: number }[]> {
  const results: { table: string; deleted: number }[] = [];

  const campaignScopedTables = SNAPSHOT_TABLES.filter(c => c.campaignScoped);

  try {
    const activeCampaigns = await db
      .select({ id: growthCampaigns.id })
      .from(growthCampaigns);
    const activeCampaignIds = activeCampaigns.map((c: any) => c.id);

    if (activeCampaignIds.length === 0) {
      console.log(`[SnapshotCleanup] ORPHAN_CHECK | No active campaigns found — skipping orphan purge to avoid accidental data loss`);
      return results;
    }

    for (const config of campaignScopedTables) {
      try {
        const orphaned = await db
          .select({
            campaignId: config.table.campaignId,
            count: sql<number>`count(*)::int`,
          })
          .from(config.table)
          .where(notInArray(config.table.campaignId, activeCampaignIds))
          .groupBy(config.table.campaignId);

        for (const { campaignId, count } of orphaned) {
          await db.delete(config.table).where(eq(config.table.campaignId, campaignId));
          results.push({ table: config.name, deleted: count });
          console.log(`[SnapshotCleanup] ORPHAN_PURGE | ${config.name} | campaign=${campaignId} | deleted=${count} | reason=campaign_not_found`);
        }
      } catch (err: any) {
        console.error(`[SnapshotCleanup] ORPHAN_PURGE_ERROR | ${config.name} | ${err.message}`);
      }
    }
  } catch (err: any) {
    console.error(`[SnapshotCleanup] ORPHAN_CHECK_ERROR | ${err.message}`);
  }

  return results;
}

async function runSnapshotCleanup(): Promise<void> {
  const startTime = Date.now();
  console.log(`[SnapshotCleanup] Starting scheduled cleanup cycle`);

  try {
    const timeResults = await purgeExpiredSnapshots();
    const capResults = await enforcePerCampaignCap();
    const orphanResults = await purgeOrphanedSnapshots();

    const totalTimeDeleted = timeResults.reduce((s, r) => s + r.deleted, 0);
    const totalCapDeleted = capResults.reduce((s, r) => s + r.deleted, 0);
    const totalOrphanDeleted = orphanResults.reduce((s, r) => s + r.deleted, 0);
    const totalDeleted = totalTimeDeleted + totalCapDeleted + totalOrphanDeleted;
    const durationMs = Date.now() - startTime;

    console.log(`[SnapshotCleanup] CYCLE_COMPLETE | expired=${totalTimeDeleted} | capped=${totalCapDeleted} | orphaned=${totalOrphanDeleted} | total=${totalDeleted} | duration=${durationMs}ms`);

    if (totalDeleted > 0) {
      await logAudit("system", "SNAPSHOT_CLEANUP", {
        expiredDeleted: totalTimeDeleted,
        cappedDeleted: totalCapDeleted,
        orphanedDeleted: totalOrphanDeleted,
        totalDeleted,
        durationMs,
        retentionDays: MAX_RETENTION_DAYS,
        maxPerCampaign: MAX_SNAPSHOTS_PER_CAMPAIGN,
        tablesAffected: [
          ...timeResults.map(r => r.table),
          ...capResults.map(r => r.table),
          ...orphanResults.map(r => r.table),
        ].filter((v, i, a) => a.indexOf(v) === i),
      });
    }
  } catch (err: any) {
    console.error(`[SnapshotCleanup] CYCLE_ERROR | ${err.message}`);
  }
}

export function startSnapshotCleanupWorker(): void {
  console.log(`[SnapshotCleanup] Starting worker (${CLEANUP_INTERVAL_MS / 3600000}h interval, ${MAX_RETENTION_DAYS}d retention, ${MAX_SNAPSHOTS_PER_CAMPAIGN} cap/campaign)`);

  initialTimeout = setTimeout(() => {
    initialTimeout = null;
    runSnapshotCleanup().catch(err => console.error("[SnapshotCleanup] Initial run error:", err));
  }, 60_000);

  cleanupTimer = setInterval(() => {
    runSnapshotCleanup().catch(err => console.error("[SnapshotCleanup] Scheduled run error:", err));
  }, CLEANUP_INTERVAL_MS);
}

export function stopSnapshotCleanupWorker(): void {
  if (initialTimeout) {
    clearTimeout(initialTimeout);
    initialTimeout = null;
  }
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
  console.log("[SnapshotCleanup] Worker stopped");
}
