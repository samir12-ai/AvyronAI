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
  snapshotOrphanObserved,
} from "@shared/schema";
import { eq, lt, sql, notInArray, inArray, and, ne, desc, or, isNull, gte, type SQL } from "drizzle-orm";
import { logAudit } from "./audit";

const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const INITIAL_DELAY_MS = 5 * 60 * 1000;
const COLD_STORAGE_DAYS = 30;
const COMPLETE_RETENTION_DAYS = 90;
const MAX_SNAPSHOTS_PER_CAMPAIGN = 20;
// 30min orchestrator budget + 30min grace before a stranded in_flight row
// is reaped (otherwise an orchestrator crash would over-protect snapshots).
const IN_FLIGHT_REAP_GRACE_MS = 60 * 60 * 1000;

async function loadInFlightJobIds(): Promise<Set<string>> {
  try {
    const rows = await db.select({ jobId: inFlightJobs.jobId }).from(inFlightJobs);
    return new Set(rows.map((r) => r.jobId));
  } catch (err) {
    console.error(`[SnapshotCleanup] IN_FLIGHT_LOAD_ERROR | ${(err as Error).message}`);
    return new Set();
  }
}

async function reapStaleInFlightJobs(): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - IN_FLIGHT_REAP_GRACE_MS);
    // Reap rows past expectedCompleteBy+grace. startedAt fallback applies
    // only when expectedCompleteBy IS NULL so long-running jobs aren't
    // killed prematurely.
    const reaped = await db
      .delete(inFlightJobs)
      .where(
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
  } catch (err) {
    console.error(`[SnapshotCleanup] IN_FLIGHT_REAP_ERROR | ${(err as Error).message}`);
    return 0;
  }
}

let cleanupTimer: ReturnType<typeof setInterval> | null = null;
let initialTimeout: ReturnType<typeof setTimeout> | null = null;

// F6.5 — fully DB-driven batched DELETE. The caller supplies a SQL
// predicate; every iteration runs `DELETE … WHERE id IN (SELECT id …
// WHERE <predicate> LIMIT N) RETURNING id`. No client-side ID array,
// no in-memory chunking — Postgres re-evaluates the predicate each
// iteration so already-deleted rows simply drop out of the next select.
const DELETE_BATCH_SIZE = 1000;
const DELETE_BATCH_SLEEP_MS = 50;
async function batchedDelete(table: any, where: SQL): Promise<number> {
  let total = 0;
  while (!isShuttingDown) {
    const subq = db
      .select({ id: table.id })
      .from(table)
      .where(where)
      .limit(DELETE_BATCH_SIZE);
    const deleted = await db
      .delete(table)
      .where(inArray(table.id, subq))
      .returning({ id: table.id });
    if (deleted.length === 0) break;
    total += deleted.length;
    if (deleted.length < DELETE_BATCH_SIZE) break;
    await new Promise((r) => setTimeout(r, DELETE_BATCH_SLEEP_MS));
  }
  if (isShuttingDown && total > 0) {
    console.log(`[SnapshotCleanup] Shutdown mid-batch — stopped after ${total} deletes`);
  }
  return total;
}

// F6.11 — graceful-shutdown gating. SIGTERM short-circuits at the top of
// every cycle and inside batchedDelete; stop() awaits the in-flight
// cycle.
let isShuttingDown = false;
let cleanupRunningPromise: Promise<void> | null = null;
let signalHandlersInstalled = false;

// F6.8 — orphan grace tracked via snapshot_orphan_observed.first_observed_at.
// A row is deletable only when (now - first_observed_at) >= ORPHAN_GRACE_DAYS.
// If the campaign is re-selected the tracking row is dropped so the grace
// counter resets.
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

async function getLatestSnapshotIds(): Promise<Map<string, Set<string>>> {
  // Per-table set of latest-per-campaign snapshot IDs (those younger than
  // the COMPLETE retention floor and therefore protected from deletion).
  const protectedByTable = new Map<string, Set<string>>();
  const maxProtectionCutoff = new Date(Date.now() - COMPLETE_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  for (const config of SNAPSHOT_TABLES.filter(c => c.campaignScoped)) {
    const ids = new Set<string>();
    protectedByTable.set(config.name, ids);
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
          if (snapshotTime >= maxProtectionCutoff) ids.add(latest.id);
        }
      }
    } catch (err) {
      console.error(`[SnapshotCleanup] PROTECT_LOAD_ERROR | ${config.name} | ${(err as Error).message}`);
    }
  }
  return protectedByTable;
}

function notInIds(idCol: any, ids: Set<string>): SQL | undefined {
  if (ids.size === 0) return undefined;
  return notInArray(idCol, [...ids]);
}

function jobIdNotInflight(jobCol: any, inflight: Set<string>): SQL | undefined {
  if (!jobCol || inflight.size === 0) return undefined;
  return or(isNull(jobCol), notInArray(jobCol, [...inflight]));
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
    } catch (err) {
      console.error(`[SnapshotCleanup] ARCHIVE_ERROR | ${config.name} | ${(err as Error).message}`);
    }
  }

  return results;
}

async function purgeExpiredSnapshots(
  protectedByTable: Map<string, Set<string>>,
  inFlightJobIds: Set<string>,
): Promise<{ table: string; deleted: number }[]> {
  const nonCompleteCutoff = new Date(Date.now() - COLD_STORAGE_DAYS * 24 * 60 * 60 * 1000);
  const completeCutoff = new Date(Date.now() - COMPLETE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const results: { table: string; deleted: number }[] = [];

  for (const config of SNAPSHOT_TABLES) {
    try {
      const tsCol = getTimestampCol(config);
      const hasStatus = config.table.status !== undefined;
      const hasJobId = config.table.jobId !== undefined;
      const protectedIds = protectedByTable.get(config.name) ?? new Set<string>();

      // Predicate composed entirely in SQL — Postgres re-evaluates per
      // batch iteration. Equivalent to:
      //   tsCol < nonCompleteCutoff
      //   AND id NOT IN (protected)
      //   AND (jobId IS NULL OR jobId NOT IN (inFlight))
      //   AND NOT (status='COMPLETE' AND tsCol >= completeCutoff)
      const ageGate = hasStatus
        ? and(
            lt(tsCol, nonCompleteCutoff),
            or(ne(config.table.status, "COMPLETE"), lt(tsCol, completeCutoff)),
          )
        : lt(tsCol, nonCompleteCutoff);

      const where = and(
        ageGate!,
        notInIds(config.table.id, protectedIds) ?? sql`true`,
        jobIdNotInflight(hasJobId ? config.table.jobId : null, inFlightJobIds) ?? sql`true`,
      )!;

      const deleted = await batchedDelete(config.table, where);
      if (deleted > 0) results.push({ table: config.name, deleted });
      console.log(`[SnapshotCleanup] COLD_STORAGE_PURGE | ${config.name} | deleted=${deleted} | nonCompleteCutoff=${nonCompleteCutoff.toISOString()} | completeCutoff=${completeCutoff.toISOString()} | protected=${protectedIds.size} | inFlight=${inFlightJobIds.size}`);
    } catch (err) {
      console.error(`[SnapshotCleanup] COLD_STORAGE_ERROR | ${config.name} | ${(err as Error).message}`);
    }
  }
  return results;
}

async function enforcePerCampaignCap(
  protectedByTable: Map<string, Set<string>>,
  inFlightJobIds: Set<string>,
): Promise<{ table: string; campaign: string; deleted: number }[]> {
  const results: { table: string; campaign: string; deleted: number }[] = [];

  for (const config of SNAPSHOT_TABLES.filter((c) => c.campaignScoped)) {
    try {
      const tsCol = getTimestampCol(config);
      const hasJobId = config.table.jobId !== undefined;
      const protectedIds = protectedByTable.get(config.name) ?? new Set<string>();

      const campaigns: { campaignId: string; count: number }[] = await db
        .select({
          campaignId: config.table.campaignId,
          count: sql<number>`count(*)::int`,
        })
        .from(config.table)
        .groupBy(config.table.campaignId)
        .having(sql`count(*) > ${MAX_SNAPSHOTS_PER_CAMPAIGN}`);

      for (const { campaignId, count } of campaigns) {
        // Bound deletion to exactly `excess` rows total. Earlier
        // implementation passed a fixed-LIMIT subquery into
        // batchedDelete; the predicate re-evaluated each iteration kept
        // matching after the cap was reached, draining the table below
        // MAX_SNAPSHOTS_PER_CAMPAIGN. Track remaining quota explicitly
        // so we stop once `excess` rows have been deleted.
        const excess = count - MAX_SNAPSHOTS_PER_CAMPAIGN;
        let remaining = excess;
        let totalDeleted = 0;
        const tsColumn = config.timestampColumn === "fetchedAt" ? "fetched_at" : "created_at";

        while (remaining > 0 && !isShuttingDown) {
          const batch = Math.min(remaining, DELETE_BATCH_SIZE);
          const oldestSubq = sql`(
            SELECT inner_t.id FROM ${config.table} inner_t
            WHERE inner_t.campaign_id = ${campaignId}
            ORDER BY inner_t.${sql.raw(tsColumn)} ASC
            LIMIT ${batch}
          )`;
          const where = and(
            eq(config.table.campaignId, campaignId),
            sql`${config.table.id} IN ${oldestSubq}`,
            notInIds(config.table.id, protectedIds) ?? sql`true`,
            jobIdNotInflight(hasJobId ? config.table.jobId : null, inFlightJobIds) ?? sql`true`,
          )!;
          const deletedRows = await db
            .delete(config.table)
            .where(where)
            .returning({ id: config.table.id });
          if (deletedRows.length === 0) break;
          totalDeleted += deletedRows.length;
          remaining -= deletedRows.length;
          if (deletedRows.length < batch) break;
          await new Promise((r) => setTimeout(r, DELETE_BATCH_SLEEP_MS));
        }

        if (totalDeleted > 0) {
          results.push({ table: config.name, campaign: campaignId, deleted: totalDeleted });
          console.log(`[SnapshotCleanup] CAP_ENFORCE | ${config.name} | campaign=${campaignId} | deleted=${totalDeleted} | was=${count} | cap=${MAX_SNAPSHOTS_PER_CAMPAIGN}`);
        }
      }
    } catch (err) {
      console.error(`[SnapshotCleanup] CAP_ENFORCE_ERROR | ${config.name} | ${(err as Error).message}`);
    }
  }
  return results;
}

async function purgeOrphanedSnapshots(
  protectedByTable: Map<string, Set<string>>,
  inFlightJobIds: Set<string>,
): Promise<{ table: string; deleted: number }[]> {
  const results: { table: string; deleted: number }[] = [];
  const campaignScopedTables = SNAPSHOT_TABLES.filter((c) => c.campaignScoped);

  try {
    const activeCampaigns = await db
      .selectDistinct({ id: campaignSelections.selectedCampaignId })
      .from(campaignSelections);
    const activeCampaignIds = activeCampaigns.map((c: { id: string }) => c.id);

    if (activeCampaignIds.length === 0) {
      console.log(`[SnapshotCleanup] ORPHAN_CHECK | No active campaigns — skipping orphan purge`);
      return results;
    }

    const orphanGraceCutoff = new Date(Date.now() - ORPHAN_GRACE_DAYS * 24 * 60 * 60 * 1000);

    for (const config of campaignScopedTables) {
      try {
        const hasJobId = config.table.jobId !== undefined;
        const protectedIds = protectedByTable.get(config.name) ?? new Set<string>();

        // 1) Reset grace counters when an orphan campaign comes back.
        try {
          await db
            .delete(snapshotOrphanObserved)
            .where(
              and(
                eq(snapshotOrphanObserved.tableName, config.name),
                inArray(snapshotOrphanObserved.campaignId, activeCampaignIds),
              )!,
            );
        } catch (e) {
          console.error(`[SnapshotCleanup] ORPHAN_RESET_ERROR | ${config.name} | ${(e as Error).message}`);
        }

        // 2) Observe currently-orphan snapshots via typed drizzle insert
        //    with ON CONFLICT DO NOTHING so re-observation is idempotent.
        const orphanRows = await db
          .select({ id: config.table.id, campaignId: config.table.campaignId })
          .from(config.table)
          .where(notInArray(config.table.campaignId, activeCampaignIds));
        if (orphanRows.length > 0) {
          try {
            await db
              .insert(snapshotOrphanObserved)
              .values(
                orphanRows.map((r) => ({
                  tableName: config.name,
                  snapshotId: r.id,
                  campaignId: r.campaignId,
                })),
              )
              .onConflictDoNothing();
          } catch (e) {
            console.error(`[SnapshotCleanup] ORPHAN_OBSERVE_ERROR | ${config.name} | ${(e as Error).message}`);
          }
        }

        // 3) Predicate-driven delete: orphan snapshots whose tracking row
        //    aged past the grace cutoff AND not protected/in-flight.
        const observedSubq = db
          .select({ id: snapshotOrphanObserved.snapshotId })
          .from(snapshotOrphanObserved)
          .where(
            and(
              eq(snapshotOrphanObserved.tableName, config.name),
              lt(snapshotOrphanObserved.firstObservedAt, orphanGraceCutoff),
            )!,
          );

        const where = and(
          notInArray(config.table.campaignId, activeCampaignIds),
          inArray(config.table.id, observedSubq),
          notInIds(config.table.id, protectedIds) ?? sql`true`,
          jobIdNotInflight(hasJobId ? config.table.jobId : null, inFlightJobIds) ?? sql`true`,
        )!;

        const deleted = await batchedDelete(config.table, where);
        if (deleted > 0) {
          results.push({ table: config.name, deleted });
          // Clean up tracking rows for now-deleted snapshots.
          try {
            await db.execute(sql`
              DELETE FROM snapshot_orphan_observed
              WHERE table_name = ${config.name}
                AND snapshot_id NOT IN (SELECT id FROM ${config.table})
            `);
          } catch (e) {
            console.error(`[SnapshotCleanup] ORPHAN_TRACK_GC_ERROR | ${config.name} | ${(e as Error).message}`);
          }
          console.log(`[SnapshotCleanup] ORPHAN_PURGE | ${config.name} | deleted=${deleted} | graceDays=${ORPHAN_GRACE_DAYS}`);
        }
      } catch (err) {
        console.error(`[SnapshotCleanup] ORPHAN_PURGE_ERROR | ${config.name} | ${(err as Error).message}`);
      }
    }
  } catch (err) {
    console.error(`[SnapshotCleanup] ORPHAN_CHECK_ERROR | ${(err as Error).message}`);
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
    } catch (err) {
      console.error(`[SnapshotCleanup] AI_TOKEN_BUDGET_PURGE_ERROR | ${(err as Error)?.message || err}`);
    }

    const protectedIds = await getLatestSnapshotIds();
    // Sum of per-table protected sets (Map.size would only report
    // table count, not the actual snapshot count).
    const protectedCount = [...protectedIds.values()].reduce((s, set) => s + set.size, 0);
    console.log(`[SnapshotCleanup] ACTIVE_SESSION_PROTECTION | protectedSnapshots=${protectedCount} | tables=${protectedIds.size}`);

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
        protectedSnapshots: protectedCount,
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
  } catch (err) {
    console.error(`[SnapshotCleanup] CYCLE_ERROR | ${(err as Error).message}`);
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
    } catch (err) {
      console.error("[SnapshotCleanup] In-flight cycle errored during shutdown:", (err as Error)?.message || err);
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
      console.error(`[SnapshotCleanup] stopSnapshotCleanupWorker errored on ${signal}:`, (err as Error)?.message || err);
    });
  };
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
}
