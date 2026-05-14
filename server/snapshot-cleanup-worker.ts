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
  inFlightJobs,
} from "@shared/schema";
import { eq, lt, sql, notInArray, inArray, and, ne, desc, or, isNull } from "drizzle-orm";
import { logAudit } from "./audit";

const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const INITIAL_DELAY_MS = 5 * 60 * 1000;
const COLD_STORAGE_DAYS = 30;
const COMPLETE_RETENTION_DAYS = 90;
const MAX_SNAPSHOTS_PER_CAMPAIGN = 20;
// stale in-flight reaper window. The orches-
// trator sets `expectedCompleteBy = now + 30min` on insert; rows older than
// this without a terminal-state DELETE are unrecoverable (orchestrator
// crashed, NEEDS_INPUT permanently abandoned, etc.) and must be reaped so
// snapshot cleanup is not blocked indefinitely.
const IN_FLIGHT_REAP_GRACE_MS = 60 * 60 * 1000; // 30min budget + 30min grace

// fetch the live in-flight job set once per
// cleanup cycle. Returned as a Set for O(1) membership tests in every
// downstream filter pass.
async function loadInFlightJobIds(): Promise<Set<string>> {
  try {
    const rows = await db.select({ jobId: inFlightJobs.jobId }).from(inFlightJobs);
    return new Set(rows.map((r) => r.jobId));
  } catch (err: any) {
    console.error(`[SnapshotCleanup] IN_FLIGHT_LOAD_ERROR | ${err.message}`);
    return new Set();
  }
}

// reaper. Drops rows whose start was so long
// ago that `expectedCompleteBy + grace` has elapsed; without this, an
// orchestrator crash or a NEEDS_INPUT run that the user abandoned would
// permanently strand the row and over-protect its snapshots.
async function reapStaleInFlightJobs(): Promise<number> {
  try {
    // BOTH predicates honour
    // the grace window. The prior version reaped immediately when
    // `expectedCompleteBy < now`, which would kill a long-running orches-
    // tration the second its 30-min budget expired. Now both clauses
    // require `… < now - GRACE` so a job has 60min past its deadline (or
    // 60min past its start when no deadline was set) before its row is
    // dropped and its snapshots become eligible for cleanup.
    const cutoff = new Date(Date.now() - IN_FLIGHT_REAP_GRACE_MS);
    const reaped = await db
      .delete(inFlightJobs)
      .where(
        // `startedAt < cutoff` is a fallback
        // ONLY when expectedCompleteBy IS NULL. pre-fix the OR clause
        // could reap a long-running job (expectedCompleteBy still in the
        // future) just because startedAt was older than the cutoff —
        // that broke the intended grace semantics. Now we either gate on
        // expectedCompleteBy when it's set, or fall back to startedAt only
        // when no deadline was recorded.
        or(
          lt(inFlightJobs.expectedCompleteBy, cutoff),
          and(
            isNull(inFlightJobs.expectedCompleteBy),
            lt(inFlightJobs.startedAt, cutoff),
          ),
        )!,
      )
      .returning({ jobId: inFlightJobs.jobId });
    if (reaped.length > 0) {
      console.log(`[SnapshotCleanup] IN_FLIGHT_REAPED | count=${reaped.length} | grace=${IN_FLIGHT_REAP_GRACE_MS / 60000}min`);
    }
    return reaped.length;
  } catch (err: any) {
    console.error(`[SnapshotCleanup] IN_FLIGHT_REAP_ERROR | ${err.message}`);
    return 0;
  }
}

let cleanupTimer: ReturnType<typeof setInterval> | null = null;
let initialTimeout: ReturnType<typeof setTimeout> | null = null;

// Seal #11 / Task #29 / F6.5 — batched DELETE helper.
// Pre-fix: every purge fired a single `DELETE … WHERE id IN (... thousands ...)`
// which held an exclusive lock on the table for the full statement and
// could explode the WAL on a busy DB. Now we chunk to 1000 ids/statement
// with a 50ms sleep between batches so other writers get a chance.
const DELETE_BATCH_SIZE = 1000;
const DELETE_BATCH_SLEEP_MS = 50;
async function batchedDeleteByIds(table: any, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  let total = 0;
  for (let i = 0; i < ids.length; i += DELETE_BATCH_SIZE) {
    if (isShuttingDown) {
      console.log(`[SnapshotCleanup] Shutdown mid-batch — stopping after ${total} deletes`);
      return total;
    }
    const chunk = ids.slice(i, i + DELETE_BATCH_SIZE);
    await db.delete(table).where(inArray(table.id, chunk));
    total += chunk.length;
    if (i + DELETE_BATCH_SIZE < ids.length) {
      await new Promise((r) => setTimeout(r, DELETE_BATCH_SLEEP_MS));
    }
  }
  return total;
}

// Seal #11 / Task #29 / F6.11 — graceful-shutdown gating.
// Pre-fix: SIGTERM cleared the timers but a tick already in-flight kept
// running (and writing) for the full cleanup duration; the process exited
// while DELETEs were mid-statement. Now `isShuttingDown` short-circuits at
// the top of every cycle and inside batchedDeleteByIds, and stop() awaits
// the in-flight cycle.
let isShuttingDown = false;
let cleanupRunningPromise: Promise<void> | null = null;
let signalHandlersInstalled = false;

// Seal #11 / Task #29 / F6.8 (architect pass-3 fix).
// Pre-fix #1: orphan deletion fired immediately on first sighting of a
// snapshot whose campaignId no longer appeared in `campaign_selections`.
// Pre-fix #2 (pass-2): we gated on snapshot age (ORPHAN_GRACE_DAYS old) —
// architect rejected this because a 30-day-old snapshot whose campaign
// was deselected just now would be deleted on the very next cycle.
// Now: every cleanup pass records the FIRST time a (table, snapshot_id)
// is observed in an orphaned state into `snapshot_orphan_observed`. A
// row is only eligible for deletion once
// `(now - first_observed_at) >= ORPHAN_GRACE_DAYS`. If a snapshot is
// later seen as non-orphan (its campaign is re-selected), the tracking
// row is removed so the grace counter resets if it later becomes orphan
// again. No `campaigns.deleted_at` column exists in this schema, so
// first-observed-orphan-at is the closest proxy to deselection age.
const ORPHAN_GRACE_DAYS = 7;

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
          accountId: row.accountId,
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

async function purgeExpiredSnapshots(protectedIds: Set<string>, inFlightJobIds: Set<string>): Promise<{ table: string; deleted: number }[]> {
  const nonCompleteCutoff = new Date(Date.now() - COLD_STORAGE_DAYS * 24 * 60 * 60 * 1000);
  const completeCutoff = new Date(Date.now() - COMPLETE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const results: { table: string; deleted: number }[] = [];

  for (const config of SNAPSHOT_TABLES) {
    try {
      const tsCol = getTimestampCol(config);
      const hasStatus = config.table.status !== undefined;
      // also pull jobId so the in-flight filter
      // below is non-trivial. Without this column the filter saw `undefined`
      // for every row and the protection was a no-op.
      const hasJobId = config.table.jobId !== undefined;

      const candidates = await db
        .select({
          id: config.table.id,
          status: hasStatus ? config.table.status : sql`'UNKNOWN'`,
          jobId: hasJobId ? config.table.jobId : sql<string | null>`NULL`,
        })
        .from(config.table)
        .where(lt(tsCol, nonCompleteCutoff));

      const toDelete: string[] = [];
      let inFlightSkipped = 0;
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

        const rowJobId: string | null = row.jobId ?? null;
        if (rowJobId && inFlightJobIds.has(rowJobId)) {
          inFlightSkipped++;
          continue;
        }

        toDelete.push(row.id);
      }

      if (toDelete.length > 0) {
        const deleted = await batchedDeleteByIds(config.table, toDelete);
        results.push({ table: config.name, deleted });
      }
      console.log(`[SnapshotCleanup] COLD_STORAGE_PURGE | ${config.name} | deleted=${toDelete.length} | nonCompleteCutoff=${nonCompleteCutoff.toISOString()} | completeCutoff=${completeCutoff.toISOString()} | protectedSkipped=${candidates.length - toDelete.length - inFlightSkipped} | inFlightSkipped=${inFlightSkipped}`);
    } catch (err: any) {
      console.error(`[SnapshotCleanup] COLD_STORAGE_ERROR | ${config.name} | ${err.message}`);
    }
  }

  return results;
}

async function enforcePerCampaignCap(protectedIds: Set<string>, inFlightJobIds: Set<string>): Promise<{ table: string; campaign: string; deleted: number }[]> {
  const results: { table: string; campaign: string; deleted: number }[] = [];

  const campaignScopedTables = SNAPSHOT_TABLES.filter(c => c.campaignScoped);

  for (const config of campaignScopedTables) {
    try {
      const tsCol = getTimestampCol(config);
      const hasJobId = config.table.jobId !== undefined;
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
        // pull jobId so we can also exclude
        // in-flight rows from the cap-driven delete (
        // gap: prior version only filtered protectedIds).
        const toDelete = await db
          .select({
            id: config.table.id,
            jobId: hasJobId ? config.table.jobId : sql<string | null>`NULL`,
          })
          .from(config.table)
          .where(eq(config.table.campaignId, campaignId))
          .orderBy(sql`${tsCol} ASC`)
          .limit(excess);

        const filteredIds = toDelete
          .filter((r: any) => !protectedIds.has(`${config.name}:${r.id}`))
          .filter((r: any) => !(r.jobId && inFlightJobIds.has(r.jobId)))
          .map((r: any) => r.id);

        if (filteredIds.length > 0) {
          const deleted = await batchedDeleteByIds(config.table, filteredIds);
          results.push({ table: config.name, campaign: campaignId, deleted });
          console.log(`[SnapshotCleanup] CAP_ENFORCE | ${config.name} | campaign=${campaignId} | deleted=${deleted} | was=${count} | cap=${MAX_SNAPSHOTS_PER_CAMPAIGN} | inFlightSkipped=${toDelete.length - filteredIds.length}`);
        }
      }
    } catch (err: any) {
      console.error(`[SnapshotCleanup] CAP_ENFORCE_ERROR | ${config.name} | ${err.message}`);
    }
  }

  return results;
}

async function purgeOrphanedSnapshots(protectedIds: Set<string>, inFlightJobIds: Set<string>): Promise<{ table: string; deleted: number }[]> {
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

    // Seal #11 / Task #29 / F6.8 — orphan grace cutoff. Snapshots younger
    // than this are PROTECTED from orphan-driven deletion: they may have
    // been written by a campaign the user has just switched away from, or
    // by an in-flight migration. Only snapshots older than the grace
    // window get reaped on the orphan path.
    const orphanGraceCutoff = new Date(Date.now() - ORPHAN_GRACE_DAYS * 24 * 60 * 60 * 1000);
    const activeIdSet = new Set(activeCampaignIds);
    for (const config of campaignScopedTables) {
      try {
        const hasJobId = config.table.jobId !== undefined;
        const orphaned = await db
          .select({
            id: config.table.id,
            campaignId: config.table.campaignId,
            jobId: hasJobId ? config.table.jobId : sql<string | null>`NULL`,
          })
          .from(config.table)
          .where(notInArray(config.table.campaignId, activeCampaignIds));

        // 1) Reset grace counters for snapshot_orphan_observed rows whose
        //    campaign has come BACK into the active selection set since
        //    last cycle. Cheap: scoped to this table_name only.
        await db.execute(sql`
          DELETE FROM snapshot_orphan_observed
          WHERE table_name = ${config.name}
            AND campaign_id = ANY(${sql.raw(`ARRAY[${activeCampaignIds.map(id => `'${id}'::uuid`).join(",") || "NULL::uuid"}]`)})
        `).catch((e: any) => console.error(`[SnapshotCleanup] ORPHAN_RESET_ERROR | ${config.name} | ${e.message}`));

        // 2) Upsert first_observed_at for every currently-orphan snapshot.
        //    ON CONFLICT DO NOTHING preserves the original observation timestamp.
        if (orphaned.length > 0) {
          const valuesSql = orphaned
            .map((r: any) => `('${config.name}', '${r.id}'::uuid, '${r.campaignId}'::uuid)`)
            .join(",");
          await db.execute(sql.raw(`
            INSERT INTO snapshot_orphan_observed (table_name, snapshot_id, campaign_id)
            VALUES ${valuesSql}
            ON CONFLICT (table_name, snapshot_id) DO NOTHING
          `)).catch((e: any) => console.error(`[SnapshotCleanup] ORPHAN_OBSERVE_ERROR | ${config.name} | ${e.message}`));
        }

        // 3) Read first_observed_at for these snapshots and gate deletion
        //    on (now - first_observed_at) >= ORPHAN_GRACE_DAYS.
        const observedRows = orphaned.length > 0
          ? await db.execute<{ snapshot_id: string; first_observed_at: Date }>(sql.raw(`
              SELECT snapshot_id, first_observed_at
              FROM snapshot_orphan_observed
              WHERE table_name = '${config.name}'
                AND snapshot_id = ANY(ARRAY[${orphaned.map((r: any) => `'${r.id}'::uuid`).join(",")}])
            `))
          : { rows: [] as any[] };
        const observedAtById = new Map<string, Date>();
        for (const r of (observedRows as any).rows ?? []) {
          observedAtById.set(r.snapshot_id, new Date(r.first_observed_at));
        }

        const toDelete: string[] = [];
        let inFlightSkipped = 0;
        let graceSkipped = 0;
        for (const row of orphaned) {
          const compositeKey = `${config.name}:${row.id}`;
          if (protectedIds.has(compositeKey)) continue;
          const rowJobId: string | null = row.jobId ?? null;
          if (rowJobId && inFlightJobIds.has(rowJobId)) {
            inFlightSkipped++;
            continue;
          }
          // Orphan-AGE gate (not snapshot-age). first_observed_at is the
          // moment THIS cleanup worker first saw the campaign as orphan.
          const observedAt = observedAtById.get(row.id);
          if (!observedAt || observedAt >= orphanGraceCutoff) {
            graceSkipped++;
            continue;
          }
          toDelete.push(row.id);
        }

        if (toDelete.length > 0) {
          const deleted = await batchedDeleteByIds(config.table, toDelete);
          results.push({ table: config.name, deleted });
          // Drop tracking rows for the snapshots we just deleted.
          await db.execute(sql.raw(`
            DELETE FROM snapshot_orphan_observed
            WHERE table_name = '${config.name}'
              AND snapshot_id = ANY(ARRAY[${toDelete.map(id => `'${id}'::uuid`).join(",")}])
          `)).catch(() => {});
          console.log(`[SnapshotCleanup] ORPHAN_PURGE | ${config.name} | deleted=${deleted} | reason=campaign_not_found | inFlightSkipped=${inFlightSkipped} | graceSkipped=${graceSkipped} | graceDays=${ORPHAN_GRACE_DAYS}`);
        } else if (graceSkipped > 0 || inFlightSkipped > 0) {
          console.log(`[SnapshotCleanup] ORPHAN_PURGE | ${config.name} | deleted=0 | inFlightSkipped=${inFlightSkipped} | graceSkipped=${graceSkipped}`);
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
  if (isShuttingDown) {
    console.log("[SnapshotCleanup] Shutdown in progress — skipping cycle");
    return;
  }
  if (cleanupRunningPromise) {
    console.log("[SnapshotCleanup] Cycle already running — skipping");
    return cleanupRunningPromise;
  }
  cleanupRunningPromise = _runSnapshotCleanupBody();
  try {
    await cleanupRunningPromise;
  } finally {
    cleanupRunningPromise = null;
  }
}

async function _runSnapshotCleanupBody(): Promise<void> {
  const startTime = Date.now();
  console.log(`[SnapshotCleanup] Starting scheduled cleanup cycle | mode=DATA_ARCHIVING | completeRetention=${COMPLETE_RETENTION_DAYS}d | nonCompleteRetention=${COLD_STORAGE_DAYS}d`);

  try {
    // Seal #11 / Task #29 / F6.1 — opportunistically sweep expired
    // ai_token_budget rows so the table can't grow unbounded.
    try {
      const { purgeExpiredTokenBudgets } = await import("./market-intelligence-v3/token-budget-store");
      const tbPurged = await purgeExpiredTokenBudgets();
      if (tbPurged > 0) console.log(`[SnapshotCleanup] AI_TOKEN_BUDGET_PURGE | deleted=${tbPurged}`);
    } catch (err: any) {
      console.error(`[SnapshotCleanup] AI_TOKEN_BUDGET_PURGE_ERROR | ${err?.message || err}`);
    }

    const protectedIds = await getLatestSnapshotIds();
    console.log(`[SnapshotCleanup] ACTIVE_SESSION_PROTECTION | protectedSnapshots=${protectedIds.size}`);

    // reap stale in_flight rows BEFORE loading
    // the active set so abandoned runs (orchestrator crash, NEEDS_INPUT
    // never resumed) stop over-protecting their snapshots.
    const reapedInFlight = await reapStaleInFlightJobs();
    const inFlightJobIds = await loadInFlightJobIds();
    console.log(`[SnapshotCleanup] IN_FLIGHT_PROTECTION | activeJobs=${inFlightJobIds.size} | reapedThisCycle=${reapedInFlight}`);

    const archiveResults = await archiveIncompatibleSnapshots();
    const timeResults = await purgeExpiredSnapshots(protectedIds, inFlightJobIds);
    const capResults = await enforcePerCampaignCap(protectedIds, inFlightJobIds);
    const orphanResults = await purgeOrphanedSnapshots(protectedIds, inFlightJobIds);

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
  console.log(`[SnapshotCleanup] Starting worker | mode=DATA_ARCHIVING | interval=${CLEANUP_INTERVAL_MS / 3600000}h | completeRetention=${COMPLETE_RETENTION_DAYS}d | nonCompleteRetention=${COLD_STORAGE_DAYS}d | cap=${MAX_SNAPSHOTS_PER_CAMPAIGN}/campaign | initialDelay=${INITIAL_DELAY_MS / 60000}min | orphanGrace=${ORPHAN_GRACE_DAYS}d`);
  isShuttingDown = false;
  installSnapshotCleanupShutdownHandlers();

  initialTimeout = setTimeout(() => {
    initialTimeout = null;
    runSnapshotCleanup().catch(err => console.error("[SnapshotCleanup] Initial run error:", err));
  }, INITIAL_DELAY_MS);

  cleanupTimer = setInterval(async () => {
    // emit worker_tick_total metric per cycle.
    // per-tick traceId for log/Sentry continuity.
    const { recordWorkerTick } = await import("./observability/otel");
    const { traceContext } = await import("./trace-context");
    const { randomUUID } = await import("node:crypto");
    await traceContext.run({ traceId: `worker-snapshot-cleanup-${randomUUID()}` }, async () => {
      try {
        await runSnapshotCleanup();
        recordWorkerTick("snapshot_cleanup", "ok");
      } catch (err) {
        recordWorkerTick("snapshot_cleanup", "error");
        console.error("[SnapshotCleanup] Scheduled run error:", err);
      }
    });
  }, CLEANUP_INTERVAL_MS);
}

export async function stopSnapshotCleanupWorker(): Promise<void> {
  isShuttingDown = true;
  if (initialTimeout) {
    clearTimeout(initialTimeout);
    initialTimeout = null;
  }
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
  // Seal #11 / Task #29 / F6.11 — await in-flight cycle so we don't kill
  // the process mid-DELETE.
  if (cleanupRunningPromise) {
    console.log("[SnapshotCleanup] Awaiting in-flight cycle before exit…");
    try {
      await cleanupRunningPromise;
    } catch (err: any) {
      console.error("[SnapshotCleanup] In-flight cycle errored during shutdown:", err?.message || err);
    }
  }
  console.log("[SnapshotCleanup] Worker stopped");
}

// Seal #11 / Task #29 / F6.11 — install SIGTERM/SIGINT handlers so the
// snapshot-cleanup-worker mirrors the autonomous-worker shutdown contract.
function installSnapshotCleanupShutdownHandlers(): void {
  if (signalHandlersInstalled) return;
  signalHandlersInstalled = true;
  const onSignal = (signal: NodeJS.Signals) => {
    if (isShuttingDown) return;
    console.log(`[SnapshotCleanup] Received ${signal} — initiating graceful shutdown.`);
    stopSnapshotCleanupWorker().catch((err: any) => {
      console.error(`[SnapshotCleanup] stopSnapshotCleanupWorker errored on ${signal}:`, err?.message || err);
    });
  };
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
}
