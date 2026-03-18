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
  campaignSelections,
  snapshotArchive,
} from "@shared/schema";
import { eq, lt, sql, notInArray, inArray, and, ne, desc } from "drizzle-orm";
import { logAudit } from "./audit";

const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const INITIAL_DELAY_MS = 5 * 60 * 1000;
const COLD_STORAGE_DAYS = 30;
const COMPLETE_RETENTION_DAYS = 90;
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

async function getLatestSnapshotIds(): Promise<Set<string>> {
  const protectedIds = new Set<string>();
  const maxProtectionCutoff = new Date(Date.now() - COMPLETE_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  for (const config of SNAPSHOT_TABLES.filter(c => c.campaignScoped)) {
    try {
      const tsCol = getTimestampCol(config);
      const campaigns = await db
        .selectDistinct({ campaignId: config.table.campaignId })
        .from(config.table);

      for (const { campaignId } of campaigns) {
        const [latest] = await db
          .select({ id: config.table.id, ts: tsCol })
          .from(config.table)
          .where(eq(config.table.campaignId, campaignId))
          .orderBy(desc(tsCol))
          .limit(1);

        if (latest) {
          const snapshotTime = latest.ts ? new Date(latest.ts) : new Date();
          if (snapshotTime >= maxProtectionCutoff) {
            protectedIds.add(`${config.name}:${latest.id}`);
          }
        }
      }
    } catch {
    }
  }

  return protectedIds;
}

async function archiveIncompatibleSnapshots(): Promise<{ table: string; archived: number }[]> {
  const results: { table: string; archived: number }[] = [];

  for (const config of SNAPSHOT_TABLES) {
    try {
      const hasStatus = config.table.status !== undefined;
      if (!hasStatus) continue;

      const incompatible = await db
        .select()
        .from(config.table)
        .where(eq(config.table.status, "INCOMPATIBLE"));

      if (incompatible.length === 0) continue;

      for (const row of incompatible) {
        await db.insert(snapshotArchive).values({
          originalId: row.id,
          sourceTable: config.name,
          accountId: row.accountId || "default",
          campaignId: row.campaignId || null,
          originalStatus: "INCOMPATIBLE",
          engineVersion: row.engineVersion || row.analysisVersion || null,
          archiveReason: "SCHEMA_MISMATCH",
          snapshotData: JSON.stringify(row),
          originalCreatedAt: row.createdAt || row.fetchedAt || new Date(),
        });

        await db.delete(config.table).where(eq(config.table.id, row.id));
      }

      results.push({ table: config.name, archived: incompatible.length });
      console.log(`[SnapshotCleanup] ARCHIVE_INCOMPATIBLE | ${config.name} | archived=${incompatible.length} | reason=schema_mismatch`);
    } catch (err: any) {
      console.error(`[SnapshotCleanup] ARCHIVE_ERROR | ${config.name} | ${err.message}`);
    }
  }

  return results;
}

async function purgeExpiredSnapshots(protectedIds: Set<string>): Promise<{ table: string; deleted: number }[]> {
  const nonCompleteCutoff = new Date(Date.now() - COLD_STORAGE_DAYS * 24 * 60 * 60 * 1000);
  const completeCutoff = new Date(Date.now() - COMPLETE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const results: { table: string; deleted: number }[] = [];

  for (const config of SNAPSHOT_TABLES) {
    try {
      const tsCol = getTimestampCol(config);
      const hasStatus = config.table.status !== undefined;

      const candidates = await db
        .select({ id: config.table.id, status: hasStatus ? config.table.status : sql`'UNKNOWN'` })
        .from(config.table)
        .where(lt(tsCol, nonCompleteCutoff));

      const toDelete: string[] = [];
      for (const row of candidates) {
        const compositeKey = `${config.name}:${row.id}`;
        if (protectedIds.has(compositeKey)) continue;

        if (row.status === "COMPLETE") {
          const rowAge = await db
            .select({ ts: tsCol })
            .from(config.table)
            .where(eq(config.table.id, row.id))
            .limit(1);
          const rowTimestamp = rowAge[0]?.ts ? new Date(rowAge[0].ts) : new Date();
          if (rowTimestamp >= completeCutoff) continue;
        }

        toDelete.push(row.id);
      }

      if (toDelete.length > 0) {
        await db.delete(config.table).where(inArray(config.table.id, toDelete));
        results.push({ table: config.name, deleted: toDelete.length });
        console.log(`[SnapshotCleanup] COLD_STORAGE_PURGE | ${config.name} | deleted=${toDelete.length} | nonCompleteCutoff=${nonCompleteCutoff.toISOString()} | completeCutoff=${completeCutoff.toISOString()} | protectedSkipped=${candidates.length - toDelete.length}`);
      }
    } catch (err: any) {
      console.error(`[SnapshotCleanup] COLD_STORAGE_ERROR | ${config.name} | ${err.message}`);
    }
  }

  return results;
}

async function enforcePerCampaignCap(protectedIds: Set<string>): Promise<{ table: string; campaign: string; deleted: number }[]> {
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

        const filteredIds = toDelete
          .map((r: any) => r.id)
          .filter((id: string) => !protectedIds.has(`${config.name}:${id}`));

        if (filteredIds.length > 0) {
          await db.delete(config.table).where(inArray(config.table.id, filteredIds));
          results.push({ table: config.name, campaign: campaignId, deleted: filteredIds.length });
          console.log(`[SnapshotCleanup] CAP_ENFORCE | ${config.name} | campaign=${campaignId} | deleted=${filteredIds.length} | was=${count} | cap=${MAX_SNAPSHOTS_PER_CAMPAIGN}`);
        }
      }
    } catch (err: any) {
      console.error(`[SnapshotCleanup] CAP_ENFORCE_ERROR | ${config.name} | ${err.message}`);
    }
  }

  return results;
}

async function purgeOrphanedSnapshots(protectedIds: Set<string>): Promise<{ table: string; deleted: number }[]> {
  const results: { table: string; deleted: number }[] = [];

  const campaignScopedTables = SNAPSHOT_TABLES.filter(c => c.campaignScoped);

  try {
    const activeCampaigns = await db
      .selectDistinct({ id: campaignSelections.selectedCampaignId })
      .from(campaignSelections);
    const activeCampaignIds = activeCampaigns.map((c: any) => c.id);

    if (activeCampaignIds.length === 0) {
      console.log(`[SnapshotCleanup] ORPHAN_CHECK | No active campaigns found — skipping orphan purge to avoid accidental data loss`);
      return results;
    }

    for (const config of campaignScopedTables) {
      try {
        const orphaned = await db
          .select({ id: config.table.id, campaignId: config.table.campaignId })
          .from(config.table)
          .where(notInArray(config.table.campaignId, activeCampaignIds));

        const toDelete: string[] = [];
        for (const row of orphaned) {
          const compositeKey = `${config.name}:${row.id}`;
          if (protectedIds.has(compositeKey)) continue;
          toDelete.push(row.id);
        }

        if (toDelete.length > 0) {
          await db.delete(config.table).where(inArray(config.table.id, toDelete));
          results.push({ table: config.name, deleted: toDelete.length });
          console.log(`[SnapshotCleanup] ORPHAN_PURGE | ${config.name} | deleted=${toDelete.length} | reason=campaign_not_found`);
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
  console.log(`[SnapshotCleanup] Starting scheduled cleanup cycle | mode=DATA_ARCHIVING | completeRetention=${COMPLETE_RETENTION_DAYS}d | nonCompleteRetention=${COLD_STORAGE_DAYS}d`);

  try {
    const protectedIds = await getLatestSnapshotIds();
    console.log(`[SnapshotCleanup] ACTIVE_SESSION_PROTECTION | protectedSnapshots=${protectedIds.size}`);

    const archiveResults = await archiveIncompatibleSnapshots();
    const timeResults = await purgeExpiredSnapshots(protectedIds);
    const capResults = await enforcePerCampaignCap(protectedIds);
    const orphanResults = await purgeOrphanedSnapshots(protectedIds);

    const totalArchived = archiveResults.reduce((s, r) => s + r.archived, 0);
    const totalTimeDeleted = timeResults.reduce((s, r) => s + r.deleted, 0);
    const totalCapDeleted = capResults.reduce((s, r) => s + r.deleted, 0);
    const totalOrphanDeleted = orphanResults.reduce((s, r) => s + r.deleted, 0);
    const totalDeleted = totalTimeDeleted + totalCapDeleted + totalOrphanDeleted;
    const durationMs = Date.now() - startTime;

    console.log(`[SnapshotCleanup] CYCLE_COMPLETE | archived=${totalArchived} | coldStoragePurged=${totalTimeDeleted} | capped=${totalCapDeleted} | orphaned=${totalOrphanDeleted} | total=${totalDeleted} | duration=${durationMs}ms`);

    if (totalDeleted > 0 || totalArchived > 0) {
      await logAudit("system", "SNAPSHOT_CLEANUP", {
        mode: "DATA_ARCHIVING",
        archived: totalArchived,
        coldStoragePurged: totalTimeDeleted,
        cappedDeleted: totalCapDeleted,
        orphanedDeleted: totalOrphanDeleted,
        totalDeleted,
        protectedSnapshots: protectedIds.size,
        durationMs,
        coldStorageDays: COLD_STORAGE_DAYS,
        maxPerCampaign: MAX_SNAPSHOTS_PER_CAMPAIGN,
        tablesAffected: [
          ...archiveResults.map(r => r.table),
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
  console.log(`[SnapshotCleanup] Starting worker | mode=DATA_ARCHIVING | interval=${CLEANUP_INTERVAL_MS / 3600000}h | completeRetention=${COMPLETE_RETENTION_DAYS}d | nonCompleteRetention=${COLD_STORAGE_DAYS}d | cap=${MAX_SNAPSHOTS_PER_CAMPAIGN}/campaign | initialDelay=${INITIAL_DELAY_MS / 60000}min`);

  initialTimeout = setTimeout(() => {
    initialTimeout = null;
    runSnapshotCleanup().catch(err => console.error("[SnapshotCleanup] Initial run error:", err));
  }, INITIAL_DELAY_MS);

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
