import { db } from "../db";
import { miRefreshSchedule, ciCompetitors, pipelineChangeEvents } from "@shared/schema";
import { and, eq, lte, sql } from "drizzle-orm";
import { startFetchJob } from "../market-intelligence-v3/fetch-orchestrator";
import crypto from "crypto";

const DEFAULT_INTERVAL_DAYS = Number(process.env.WATCHTOWER_INTERVAL_DAYS) || 3;
export const CONFIRMATION_DELAY_HOURS = Number(process.env.WATCHTOWER_CONFIRMATION_HOURS) || 24;
const RETRY_DELAY_HOURS = Number(process.env.WATCHTOWER_RETRY_HOURS) || 6;
const MAX_RETRIES = Number(process.env.WATCHTOWER_MAX_RETRIES) || 2;
const BATCH_SIZE = Number(process.env.WATCHTOWER_BATCH_SIZE) || 10;
const LEASE_TIMEOUT_MINS = Number(process.env.WATCHTOWER_LEASE_TIMEOUT_MINS) || 120;

// Generate a unique ID for this worker instance
const WORKER_INSTANCE_ID = `worker_${crypto.randomBytes(4).toString('hex')}`;

/**
 * Initializes a new monitoring schedule for a competitor.
 * Must be called whenever a competitor is added.
 */
export async function initializeCompetitorMonitoring(accountId: string, campaignId: string, competitorId: string) {
  try {
    await db.insert(miRefreshSchedule).values({
      accountId,
      campaignId,
      competitorId,
      intervalDays: DEFAULT_INTERVAL_DAYS,
      nextRefreshAt: new Date(), // Start immediately
      retryCount: 0,
      status: "active",
      refreshReason: "initialization",
    }).onConflictDoNothing({ target: [miRefreshSchedule.accountId, miRefreshSchedule.campaignId, miRefreshSchedule.competitorId] });
    console.log(`[WatchtowerScheduler] Initialized schedule for ${competitorId}`);
  } catch (err: any) {
    console.error(`[WatchtowerScheduler] Failed to initialize schedule: ${err.message}`);
  }
}

/**
 * Safe reconciliation step for migrated or missed competitors.
 * Creates schedules for any active competitor missing one.
 */
export async function reconcileCompetitorSchedules() {
  const missing = await db.execute(sql`
    SELECT c.id, c.account_id, c.campaign_id
    FROM ci_competitors c
    LEFT JOIN mi_refresh_schedule s ON c.id = s.competitor_id
    WHERE c.is_active = true AND s.id IS NULL
  `);
  
  if (missing.rows.length > 0) {
    console.log(`[WatchtowerScheduler] Reconciliation found ${missing.rows.length} competitors missing schedules. Migrating...`);
    for (const row of missing.rows) {
      await initializeCompetitorMonitoring(row.account_id as string, row.campaign_id as string, row.id as string);
    }
  }
}

/**
 * Recovers stale locks (running longer than lease timeout).
 */
export async function recoverStaleLocks() {
  try {
    const recovered = await db.execute(sql`
      UPDATE mi_refresh_schedule
      SET status = 'active', claimed_at = NULL, claimed_by = NULL
      WHERE status = 'running' 
      AND claimed_at < NOW() - INTERVAL '${sql.raw(LEASE_TIMEOUT_MINS.toString())} minutes'
      RETURNING id
    `);
    if (recovered.rows.length > 0) {
      console.log(`[WatchtowerScheduler] Recovered ${recovered.rows.length} stale schedule locks.`);
    }
  } catch (err: any) {
    console.error(`[WatchtowerScheduler] Stale lock recovery error: ${err.message}`);
  }
}

let isSchedulerRunning = false;
let schedulerTimeout: ReturnType<typeof setTimeout> | null = null;

export async function runSchedulerCycle() {
  if (isSchedulerRunning) return;
  isSchedulerRunning = true;
  
  try {
    // 1. Reconcile and recover
    await reconcileCompetitorSchedules();
    await recoverStaleLocks();

    // 2. Atomic claim via FOR UPDATE SKIP LOCKED
    console.log(`[WatchtowerScheduler:${WORKER_INSTANCE_ID}] Attempting to claim up to ${BATCH_SIZE} due schedules...`);
    const claimedRows = await db.execute(sql`
      UPDATE mi_refresh_schedule
      SET status = 'running',
          claimed_at = NOW(),
          claimed_by = ${WORKER_INSTANCE_ID}
      WHERE id IN (
        SELECT id FROM mi_refresh_schedule
        WHERE next_refresh_at <= NOW() AND status = 'active'
        ORDER BY next_refresh_at ASC
        LIMIT ${BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *;
    `);

    const dueSchedules = claimedRows.rows;

    if (dueSchedules.length > 0) {
      console.log(`[WatchtowerScheduler:${WORKER_INSTANCE_ID}] Successfully claimed ${dueSchedules.length} schedules.`);
      
      // 3. Batching: Group by campaignId
      const groupedByCampaign: Record<string, typeof dueSchedules> = {};
      for (const sched of dueSchedules) {
        const campaignId = sched.campaign_id as string;
        if (!groupedByCampaign[campaignId]) groupedByCampaign[campaignId] = [];
        groupedByCampaign[campaignId].push(sched);
      }

      // Execute batches
      for (const [campaignId, schedules] of Object.entries(groupedByCampaign)) {
        const accountId = schedules[0].account_id as string;
        const competitorIds = schedules.map(s => s.competitor_id as string);
        
        console.log(`[WatchtowerScheduler:${WORKER_INSTANCE_ID}] Batching fetch for campaign ${campaignId} with ${competitorIds.length} competitors.`);

        try {
          // startFetchJob takes competitorIds array
          await startFetchJob(accountId, campaignId, competitorIds);
          
          // On success, reset to normal interval
          for (const sched of schedules) {
            const intervalDays = sched.interval_days as number;
            await db.update(miRefreshSchedule)
              .set({
                nextRefreshAt: new Date(Date.now() + intervalDays * 24 * 60 * 60 * 1000),
                lastRefreshAt: new Date(),
                retryCount: 0,
                status: "active",
                refreshReason: "normal_monitoring",
                claimedAt: null,
                claimedBy: null
              })
              .where(eq(miRefreshSchedule.id, sched.id as string));
          }
        } catch (jobErr: any) {
          console.error(`[WatchtowerScheduler:${WORKER_INSTANCE_ID}] Fetch job failed for campaign ${campaignId}: ${jobErr.message}`);
          
          // Retry logic
          for (const sched of schedules) {
            const nextRetryCount = (sched.retry_count as number) + 1;
            const schedId = sched.id as string;
            if (nextRetryCount > MAX_RETRIES) {
              console.log(`[WatchtowerScheduler:${WORKER_INSTANCE_ID}] Max retries reached for ${sched.competitor_id}. Aborting back to normal schedule.`);
              await db.update(miRefreshSchedule)
                .set({
                  nextRefreshAt: new Date(Date.now() + (sched.interval_days as number) * 24 * 60 * 60 * 1000),
                  retryCount: 0,
                  status: "active",
                  refreshReason: "max_retries_exceeded",
                  claimedAt: null,
                  claimedBy: null
                })
                .where(eq(miRefreshSchedule.id, schedId));
            } else {
              const backoffHours = nextRetryCount === 1 ? RETRY_DELAY_HOURS : 24;
              console.log(`[WatchtowerScheduler:${WORKER_INSTANCE_ID}] Retrying ${sched.competitor_id} in ${backoffHours} hours (attempt ${nextRetryCount})`);
              await db.update(miRefreshSchedule)
                .set({
                  nextRefreshAt: new Date(Date.now() + backoffHours * 60 * 60 * 1000),
                  retryCount: nextRetryCount,
                  status: "active",
                  refreshReason: "retry",
                  claimedAt: null,
                  claimedBy: null
                })
                .where(eq(miRefreshSchedule.id, schedId));
            }
          }
        }
      }
    }
  } catch (err: any) {
    console.error(`[WatchtowerScheduler:${WORKER_INSTANCE_ID}] Cycle error: ${err.message}`);
  } finally {
    isSchedulerRunning = false;
    
    // Random jitter 30-180 minutes (for production, shorter for dev test maybe)
    const jitterMin = 30;
    const jitterMax = 180;
    const nextRunMins = Math.floor(Math.random() * (jitterMax - jitterMin + 1)) + jitterMin;
    console.log(`[WatchtowerScheduler:${WORKER_INSTANCE_ID}] Next cycle in ${nextRunMins} minutes.`);
    
    // In local dev, we might want faster testing, but we'll stick to jitter structure
    const delayMs = process.env.NODE_ENV === "production" ? nextRunMins * 60 * 1000 : 30 * 1000; // 30s in dev
    
    schedulerTimeout = setTimeout(runSchedulerCycle, delayMs);
  }
}

export function startWatchtowerScheduler() {
  if (schedulerTimeout) return;
  console.log(`[WatchtowerScheduler:${WORKER_INSTANCE_ID}] Starting...`);
  runSchedulerCycle();
}

export function stopWatchtowerScheduler() {
  if (schedulerTimeout) {
    clearTimeout(schedulerTimeout);
    schedulerTimeout = null;
  }
}

/**
 * Triggers a confirmation fetch in 24 hours. Called by the Watchtower engine
 * when a new candidate event is detected.
 */
export async function scheduleConfirmationFetch(accountId: string, campaignId: string, competitorId: string) {
  try {
    console.log(`[WatchtowerScheduler] Candidate detected for ${competitorId}. Scheduling confirmation in ${CONFIRMATION_DELAY_HOURS}h.`);
    await db.update(miRefreshSchedule)
      .set({
        nextRefreshAt: new Date(Date.now() + CONFIRMATION_DELAY_HOURS * 60 * 60 * 1000),
        status: "active",
        refreshReason: "confirmation_fetch",
        claimedAt: null,
        claimedBy: null
      })
      .where(and(
        eq(miRefreshSchedule.accountId, accountId),
        eq(miRefreshSchedule.campaignId, campaignId),
        eq(miRefreshSchedule.competitorId, competitorId)
      ));
  } catch (err: any) {
    console.error(`[WatchtowerScheduler] Failed to schedule confirmation fetch: ${err.message}`);
  }
}
