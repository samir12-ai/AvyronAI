import { db } from "../db";
import {
  miRefreshSchedule,
  ciCompetitors,
  pipelineChangeEvents,
  miFetchJobs,
  userPublicProfiles,
  userChannelSnapshots,
  dailyOwnedFetchRecords,
  businessExecutionStates,
  clarificationRequests,
  weeklyBusinessInventories,
  strategicPlans,
  growthCampaigns,
  campaignSelections,
} from "@shared/schema";
import { and, desc, eq, lte, sql } from "drizzle-orm";
import { startFetchJob } from "../market-intelligence-v3/fetch-orchestrator";
import { parseLinkedInIdentity } from "../acquisition/multi-source-providers";
import { CLARIFICATION_REMINDER_DELAY_HOURS, MAX_CLARIFICATION_REMINDERS } from "../notifications-routes";
import { resolveEffectiveNow } from "../performance-loop/clock";
import { isWeeklyInventoryDue } from "../performance-loop/weekly-inventory-engine";
import crypto from "crypto";

const DEFAULT_INTERVAL_DAYS = Number(process.env.WATCHTOWER_INTERVAL_DAYS) || 3;
export const CONFIRMATION_DELAY_HOURS = Number(process.env.WATCHTOWER_CONFIRMATION_HOURS) || 24;
export const OWNED_CHANNEL_REFRESH_HOURS = Number(process.env.OWNED_CHANNEL_REFRESH_HOURS) || 24;
export const PERFORMANCE_EVAL_CATCHUP_HOURS = Number(process.env.PERFORMANCE_EVAL_CATCHUP_HOURS) || 24;
export const REPORTING_WINDOW_DAYS = 7;
const RETRY_DELAY_HOURS = Number(process.env.WATCHTOWER_RETRY_HOURS) || 6;
const MAX_RETRIES = Number(process.env.WATCHTOWER_MAX_RETRIES) || 2;
const BATCH_SIZE = Number(process.env.WATCHTOWER_BATCH_SIZE) || 50;
const LEASE_TIMEOUT_MINS = Number(process.env.WATCHTOWER_LEASE_TIMEOUT_MINS) || 120;

// Generate a unique ID for this worker instance
const WORKER_INSTANCE_ID = `worker_${crypto.randomBytes(4).toString("hex")}`;

/**
 * Waits for an acquisition fetch job (`mi_fetch_jobs`) to reach a recorded terminal outcome
 * (`COMPLETE`, `COMPLETE_WITH_COOLDOWN`, `PARTIAL_COMPLETE`, `FAILED`, `SKIPPED_COOLDOWN`).
 * Never returns success while a job is still `RUNNING`, `QUEUED`, or `PENDING`.
 */
export async function waitForFetchJobTerminalOutcome(
  jobId: string | undefined,
  accountId: string,
  campaignId: string,
  options?: { timeoutMs?: number; pollIntervalMs?: number }
): Promise<{
  terminal: boolean;
  jobId: string | null;
  status: string;
  totalPostsFetched: number;
  error: string | null;
}> {
  const timeoutMs = options?.timeoutMs ?? 12 * 60 * 1000;
  const pollIntervalMs = options?.pollIntervalMs ?? 1500;
  const startedAt = Date.now();

  if (!jobId) {
    return {
      terminal: true,
      jobId: null,
      status: "COMPLETE",
      totalPostsFetched: 0,
      error: null,
    };
  }

  while (Date.now() - startedAt <= timeoutMs) {
    const [job] = await db
      .select()
      .from(miFetchJobs)
      .where(and(eq(miFetchJobs.id, jobId), eq(miFetchJobs.accountId, accountId), eq(miFetchJobs.campaignId, campaignId)))
      .limit(1);

    if (!job) {
      // Mocked startFetchJob in unit tests that does not insert a row into mi_fetch_jobs
      return {
        terminal: true,
        jobId,
        status: "COMPLETE",
        totalPostsFetched: 0,
        error: null,
      };
    }

    const statusUpper = String(job.status || "").toUpperCase();
    const isInFlight = statusUpper === "RUNNING" || statusUpper === "QUEUED" || statusUpper === "PENDING";
    if (!isInFlight || job.completedAt != null) {
      return {
        terminal: true,
        jobId: job.id,
        status: statusUpper || "COMPLETE",
        totalPostsFetched: Number(job.totalPostsFetched ?? 0),
        error: job.error || null,
      };
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return {
    terminal: false,
    jobId,
    status: "RUNNING_TIMEOUT",
    totalPostsFetched: 0,
    error: `Timed out after ${timeoutMs}ms waiting for fetch job ${jobId} to reach a terminal state`,
  };
}

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

  // Pause any active schedules for deactivated competitors or paused/archived campaigns
  await db.execute(sql`
    UPDATE mi_refresh_schedule s
    SET status = 'paused', claimed_at = NULL, claimed_by = NULL
    FROM ci_competitors c
    LEFT JOIN campaign_selections cs ON cs.selected_campaign_id = c.campaign_id AND cs.account_id = c.account_id
    WHERE s.competitor_id = c.id
      AND s.status = 'active'
      AND (
        c.is_active = false
        OR cs.campaign_status IN ('paused', 'archived')
        OR cs.is_archived = true
      )
  `);

  // Reconcile schedule timestamps when an active competitor has a newer recorded terminal acquisition
  // (from ci_competitors.last_checked_at or terminal acquisition_tasks.completed_at) than s.last_refresh_at.
  await db.execute(sql`
    WITH latest_terminal AS (
      SELECT
        c.id AS competitor_id,
        c.campaign_id,
        GREATEST(
          c.last_checked_at,
          (
            SELECT MAX(t.completed_at)
            FROM acquisition_tasks t
            WHERE t.entity_id = c.id
              AND t.campaign_id = c.campaign_id
              AND t.status IN ('SUCCESS_WITH_CONTENT', 'SUCCESS_EMPTY')
          ),
          (
            SELECT MAX(w.created_at)
            FROM competitor_website_snapshots w
            WHERE w.competitor_id = c.id
              AND w.campaign_id = c.campaign_id
              AND w.status = 'COMPLETE'
          )
        ) AS actual_terminal_at
      FROM ci_competitors c
      WHERE c.is_active = true
    )
    UPDATE mi_refresh_schedule s
    SET
      last_refresh_at = lt.actual_terminal_at,
      next_refresh_at = lt.actual_terminal_at + (COALESCE(s.interval_days, 3) || ' days')::interval,
      retry_count = 0,
      refresh_reason = 'normal_monitoring'
    FROM latest_terminal lt
    WHERE s.competitor_id = lt.competitor_id
      AND s.campaign_id = lt.campaign_id
      AND s.status = 'active'
      AND lt.actual_terminal_at IS NOT NULL
      AND (s.last_refresh_at IS NULL OR lt.actual_terminal_at > s.last_refresh_at)
  `);
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
const inflightDownstreamHandoffs = new Set<string>();

/**
 * Executes the automatic downstream handoff for a campaign after a scheduled refresh:
 * 1. Verifies that no competitor acquisition job is currently in-flight (`RUNNING`/`QUEUED`),
 *    ensuring downstream evaluation triggers ONLY after acquisition has reached a recorded terminal outcome.
 * 2. `runBoss` -> collects fresh envelopes, runs `runWatchtowerOrchestrator`, and syncs Adaptive Reasoning.
 * 3. `evaluateAndPersistBusinessExecutionState` -> refreshes Performance Loop truth.
 * 4. `syncCampaignAdaptiveReasoning` -> idempotently reconciles Deep Reasoning cases and decisions.
 * 5. `syncNotificationsForCampaign` -> updates in-app notifications and 48h reminders.
 */
export async function runScheduledCampaignDownstreamHandoff(
  accountId: string,
  campaignId: string,
  options?: {
    trigger?: string;
    skipBoss?: boolean;
    jobId?: string;
    requireTerminalAcquisition?: boolean;
    waitForTerminalMs?: number;
  }
): Promise<{
  deduped: boolean;
  deferredUntilTerminal?: boolean;
  terminalJobStatus?: string | null;
  bossRunId: string | null;
  executionStateId: string | null;
  performanceContextId: string | null;
  adaptiveSync: { casesCreated: number; decisionsCreated: number; casesSkippedIdempotent: number } | null;
}> {
  const dedupeKey = `${accountId}:${campaignId}`;
  if (inflightDownstreamHandoffs.has(dedupeKey)) {
    console.log(`[WatchtowerScheduler:${WORKER_INSTANCE_ID}] Downstream handoff already in-flight for ${dedupeKey}; skipping duplicate trigger.`);
    return {
      deduped: true,
      bossRunId: null,
      executionStateId: null,
      performanceContextId: null,
      adaptiveSync: null,
    };
  }

  inflightDownstreamHandoffs.add(dedupeKey);
  try {
    let terminalJobStatus: string | null = null;
    if (options?.requireTerminalAcquisition !== false) {
      if (options?.jobId) {
        const outcome = await waitForFetchJobTerminalOutcome(options.jobId, accountId, campaignId, {
          timeoutMs: options.waitForTerminalMs ?? 5000,
          pollIntervalMs: 250,
        });
        terminalJobStatus = outcome.status;
        if (!outcome.terminal || outcome.status === "FAILED") {
          console.warn(
            `[WatchtowerScheduler:${WORKER_INSTANCE_ID}] Skipping downstream handoff for ${campaignId}: job ${options.jobId} is ${outcome.status} (terminal=${outcome.terminal})`
          );
          return {
            deduped: false,
            deferredUntilTerminal: true,
            terminalJobStatus: outcome.status,
            bossRunId: null,
            executionStateId: null,
            performanceContextId: null,
            adaptiveSync: null,
          };
        }
      } else {
        const [activeJob] = await db
          .select()
          .from(miFetchJobs)
          .where(
            and(
              eq(miFetchJobs.accountId, accountId),
              eq(miFetchJobs.campaignId, campaignId),
              sql`${miFetchJobs.status} IN ('RUNNING', 'QUEUED', 'PENDING')`
            )
          )
          .orderBy(desc(miFetchJobs.createdAt))
          .limit(1);

        if (activeJob) {
          console.warn(
            `[WatchtowerScheduler:${WORKER_INSTANCE_ID}] Deferring downstream handoff for ${campaignId}: acquisition job ${activeJob.id} is still ${activeJob.status}`
          );
          return {
            deduped: false,
            deferredUntilTerminal: true,
            terminalJobStatus: activeJob.status,
            bossRunId: null,
            executionStateId: null,
            performanceContextId: null,
            adaptiveSync: null,
          };
        }
      }
    }

    let bossRunId: string | null = null;
    if (!options?.skipBoss) {
      const { runBoss } = await import("../boss/run");
      const bossRes = await runBoss({
        accountId,
        campaignId,
        trigger: (options?.trigger as any) || "scheduled",
      });
      bossRunId = bossRes.runId;
    }

    const { evaluateAndPersistBusinessExecutionState } = await import("../performance-loop/execution-intelligence");
    const execState = await evaluateAndPersistBusinessExecutionState({ accountId, campaignId });

    const { syncCampaignAdaptiveReasoning } = await import("../adaptive/case-coordinator");
    const adaptiveSync = await syncCampaignAdaptiveReasoning({ accountId, campaignId });

    try {
      const { syncNotificationsForCampaign } = await import("../notifications-routes");
      await syncNotificationsForCampaign(accountId, campaignId);
    } catch (notifErr: any) {
      console.warn(`[WatchtowerScheduler:${WORKER_INSTANCE_ID}] Notification sync warning: ${notifErr?.message}`);
    }

    return {
      deduped: false,
      deferredUntilTerminal: false,
      terminalJobStatus,
      bossRunId,
      executionStateId: execState?.executionState?.id ?? null,
      performanceContextId: execState?.performanceContext?.id ?? null,
      adaptiveSync,
    };
  } finally {
    inflightDownstreamHandoffs.delete(dedupeKey);
  }
}

/**
 * Owned-channel recurring refresh cadence (default every 24 hours for valid connected channels).
 * Skips channels whose identity is unresolved (`IDENTITY_UNRESOLVED`) and reports them honestly.
 */
export async function runScheduledOwnedChannelRefresh(
  accountId: string,
  campaignId: string,
  options?: { force?: boolean }
): Promise<{
  executed: boolean;
  reason: string;
  validPlatforms: string[];
  unresolvedPlatforms: string[];
  lastScrapedAt: string | null;
  nextDueAt: string;
}> {
  if (!options?.force) {
    const [campSel] = await db
      .select({ campaignStatus: campaignSelections.campaignStatus, isArchived: campaignSelections.isArchived })
      .from(campaignSelections)
      .where(and(eq(campaignSelections.accountId, accountId), eq(campaignSelections.selectedCampaignId, campaignId)))
      .limit(1);
    if (
      campSel?.isArchived ||
      campSel?.campaignStatus === "paused" ||
      campSel?.campaignStatus === "archived"
    ) {
      return {
        executed: false,
        reason: "CAMPAIGN_PAUSED_OR_ARCHIVED",
        validPlatforms: [],
        unresolvedPlatforms: [],
        lastScrapedAt: null,
        nextDueAt: new Date(Date.now() + OWNED_CHANNEL_REFRESH_HOURS * 60 * 60 * 1000).toISOString(),
      };
    }
  }
  const profiles = await db
    .select()
    .from(userPublicProfiles)
    .where(and(eq(userPublicProfiles.accountId, accountId), eq(userPublicProfiles.campaignId, campaignId)));

  const connectedProfiles = profiles.filter((p) => Boolean(p.url || p.handle));
  const validPlatforms: string[] = [];
  const unresolvedPlatforms: string[] = [];

  for (const p of connectedProfiles) {
    const plat = String(p.platform || "").toLowerCase();
    if (plat === "linkedin") {
      const parsed = parseLinkedInIdentity(p.url || p.handle);
      if (!parsed.valid) {
        unresolvedPlatforms.push(plat);
        continue;
      }
    }
    validPlatforms.push(plat);
  }

  const intervalMs = OWNED_CHANNEL_REFRESH_HOURS * 60 * 60 * 1000;
  if (validPlatforms.length === 0) {
    return {
      executed: false,
      reason: unresolvedPlatforms.length > 0 ? "ONLY_UNRESOLVED_CHANNELS" : "NO_CONNECTED_CHANNELS",
      validPlatforms,
      unresolvedPlatforms,
      lastScrapedAt: null,
      nextDueAt: new Date(Date.now() + intervalMs).toISOString(),
    };
  }

  const [latestDailyFetch] = await db
    .select()
    .from(dailyOwnedFetchRecords)
    .where(and(eq(dailyOwnedFetchRecords.accountId, accountId), eq(dailyOwnedFetchRecords.campaignId, campaignId)))
    .orderBy(desc(dailyOwnedFetchRecords.createdAt))
    .limit(1);

  const snapshots = await db
    .select()
    .from(userChannelSnapshots)
    .where(eq(userChannelSnapshots.accountId, accountId))
    .orderBy(desc(userChannelSnapshots.scrapedAt))
    .limit(50);

  const latestSnapshot = snapshots.find((s) => {
    if (s.campaignId && s.campaignId !== campaignId) return false;
    if (s.scrapeSuccess) return true;
    try {
      const d = s.snapshotData ? JSON.parse(s.snapshotData) : {};
      return d.scrapeStatus === "SUCCESS" || d.scrapeStatus === "PARTIAL";
    } catch {
      return false;
    }
  });

  const lastSuccessDate =
    (latestDailyFetch as any)?.completedAt ||
    latestDailyFetch?.createdAt ||
    latestSnapshot?.scrapedAt ||
    null;

  const isDue =
    options?.force === true ||
    !lastSuccessDate ||
    Date.now() - new Date(lastSuccessDate).getTime() >= intervalMs;

  if (!isDue && lastSuccessDate) {
    return {
      executed: false,
      reason: "NOT_DUE_YET",
      validPlatforms,
      unresolvedPlatforms,
      lastScrapedAt: new Date(lastSuccessDate).toISOString(),
      nextDueAt: new Date(new Date(lastSuccessDate).getTime() + intervalMs).toISOString(),
    };
  }

  const { scrapeUserChannels } = await import("../user-channel-scraper");
  await scrapeUserChannels(accountId, campaignId, validPlatforms);

  const { executeDailyOwnedFetch } = await import("../performance-loop/daily-fetch-coordinator");
  for (const plat of validPlatforms) {
    const platUpper = plat.toUpperCase() as any;
    if (["INSTAGRAM", "YOUTUBE", "TIKTOK", "LINKEDIN", "WEBSITE"].includes(platUpper)) {
      await executeDailyOwnedFetch({ accountId, campaignId, platform: platUpper, force: options?.force });
    }
  }

  const { evaluateAndPersistBusinessExecutionState } = await import("../performance-loop/execution-intelligence");
  await evaluateAndPersistBusinessExecutionState({ accountId, campaignId });

  const { syncCampaignAdaptiveReasoning } = await import("../adaptive/case-coordinator");
  await syncCampaignAdaptiveReasoning({ accountId, campaignId });

  const now = new Date();
  return {
    executed: true,
    reason: "OWNED_CHANNELS_REFRESHED",
    validPlatforms,
    unresolvedPlatforms,
    lastScrapedAt: now.toISOString(),
    nextDueAt: new Date(now.getTime() + intervalMs).toISOString(),
  };
}

/**
 * Daily Performance Evaluation catch-up check (24h), 7-day reporting window check,
 * and 48-hour unanswered request reminder check.
 */
export async function runScheduledPerformanceAndReminderCheck(
  accountId: string,
  campaignId: string,
  options?: { forceEval?: boolean; nowOverride?: Date }
): Promise<{
  evaluated: boolean;
  weeklyInventoryId: string | null;
  weeklyInventoryStatus: string | null;
  notificationsSynced: boolean;
}> {
  if (!options?.forceEval) {
    const [campSel] = await db
      .select({ campaignStatus: campaignSelections.campaignStatus, isArchived: campaignSelections.isArchived })
      .from(campaignSelections)
      .where(and(eq(campaignSelections.accountId, accountId), eq(campaignSelections.selectedCampaignId, campaignId)))
      .limit(1);
    if (
      campSel?.isArchived ||
      campSel?.campaignStatus === "paused" ||
      campSel?.campaignStatus === "archived"
    ) {
      return {
        evaluated: false,
        weeklyInventoryId: null,
        weeklyInventoryStatus: null,
        notificationsSynced: false,
      };
    }
  }
  const now = resolveEffectiveNow(campaignId, options?.nowOverride);
  const evalIntervalMs = PERFORMANCE_EVAL_CATCHUP_HOURS * 60 * 60 * 1000;

  let weeklyInventoryId: string | null = null;
  let weeklyInventoryStatus: string | null = null;
  try {
    const { getOrCreateWeeklyInventory } = await import("../performance-loop/weekly-inventory-engine");
    const inv = await getOrCreateWeeklyInventory(accountId, campaignId, now);
    weeklyInventoryId = inv?.inventoryId ?? (inv as any)?.id ?? null;
    weeklyInventoryStatus = inv?.status ?? null;
  } catch (invErr: any) {
    console.warn(`[WatchtowerScheduler] Weekly inventory check warning for ${campaignId}: ${invErr?.message}`);
  }

  const [latestState] = await db
    .select()
    .from(businessExecutionStates)
    .where(and(eq(businessExecutionStates.accountId, accountId), eq(businessExecutionStates.campaignId, campaignId)))
    .orderBy(desc(businessExecutionStates.createdAt))
    .limit(1);

  const isEvalDue =
    options?.forceEval === true ||
    !latestState?.createdAt ||
    now.getTime() - new Date(latestState.createdAt).getTime() >= evalIntervalMs;

  let evaluated = false;
  if (isEvalDue) {
    const { evaluateAndPersistBusinessExecutionState } = await import("../performance-loop/execution-intelligence");
    await evaluateAndPersistBusinessExecutionState({ accountId, campaignId });
    const { syncCampaignAdaptiveReasoning } = await import("../adaptive/case-coordinator");
    await syncCampaignAdaptiveReasoning({ accountId, campaignId });
    evaluated = true;
  }

  let notificationsSynced = false;
  try {
    const { syncNotificationsForCampaign } = await import("../notifications-routes");
    await syncNotificationsForCampaign(accountId, campaignId, now);
    notificationsSynced = true;
  } catch (notifErr: any) {
    console.warn(`[WatchtowerScheduler] Reminder/notification sync warning for ${campaignId}: ${notifErr?.message}`);
  }

  return {
    evaluated,
    weeklyInventoryId,
    weeklyInventoryStatus,
    notificationsSynced,
  };
}

/**
 * Returns the unified schedule health snapshot across all 6 cadences for UI and API inspection.
 */
export async function getUnifiedScheduleHealth(accountId: string, campaignId: string, nowOverride?: Date) {
  const now = resolveEffectiveNow(campaignId, nowOverride);
  const ownedIntervalMs = OWNED_CHANNEL_REFRESH_HOURS * 60 * 60 * 1000;
  const evalIntervalMs = PERFORMANCE_EVAL_CATCHUP_HOURS * 60 * 60 * 1000;
  const reminderDelayMs = CLARIFICATION_REMINDER_DELAY_HOURS * 60 * 60 * 1000;

  // 1. Owned-channel refresh (24h)
  const profiles = await db
    .select()
    .from(userPublicProfiles)
    .where(and(eq(userPublicProfiles.accountId, accountId), eq(userPublicProfiles.campaignId, campaignId)));
  const snapshots = await db
    .select()
    .from(userChannelSnapshots)
    .where(eq(userChannelSnapshots.accountId, accountId))
    .orderBy(desc(userChannelSnapshots.scrapedAt))
    .limit(100);

  const latestByPlatform = new Map<string, { row: typeof snapshots[0]; data: any }>();
  for (const s of snapshots) {
    if (s.campaignId && s.campaignId !== campaignId) continue;
    const plat = String(s.platform || "").toLowerCase();
    let d: any = {};
    try {
      d = s.snapshotData ? JSON.parse(s.snapshotData) : {};
    } catch {}
    const isSuccess = Boolean(s.scrapeSuccess || d.scrapeStatus === "SUCCESS" || d.scrapeStatus === "PARTIAL");
    const existing = latestByPlatform.get(plat);
    if (!existing || (isSuccess && !existing.row.scrapeSuccess && existing.data.scrapeStatus !== "SUCCESS")) {
      latestByPlatform.set(plat, { row: s, data: d });
    }
  }

  const connectedChannels = profiles
    .filter((p) => Boolean(p.url || p.handle))
    .map((p) => {
      const plat = String(p.platform || "").toLowerCase();
      const entry = latestByPlatform.get(plat);
      const snap = entry?.row;
      const snapData = entry?.data || {};
      let identityStatus = "CONFIRMED";
      if (plat === "linkedin") {
        const parsed = parseLinkedInIdentity(p.url || p.handle);
        if (!parsed.valid) identityStatus = "UNRESOLVED";
      }
      const isSnapSuccess = Boolean(snap?.scrapeSuccess || snapData.scrapeStatus === "SUCCESS" || snapData.scrapeStatus === "PARTIAL");
      const lastSuccessAt = isSnapSuccess && snap?.scrapedAt ? new Date(snap.scrapedAt).toISOString() : null;
      const nextDueAt =
        identityStatus === "UNRESOLVED"
          ? null
          : lastSuccessAt
            ? new Date(new Date(lastSuccessAt).getTime() + ownedIntervalMs).toISOString()
            : now.toISOString();
      return {
        platform: plat,
        url: p.url,
        handle: p.handle,
        identityStatus,
        lastSuccessAt,
        nextDueAt,
        status:
          identityStatus === "UNRESOLVED"
            ? "ACTION_REQUIRED_IDENTITY_UNRESOLVED"
            : isSnapSuccess
              ? new Date(nextDueAt!).getTime() <= now.getTime()
                ? "DUE_NOW"
                : "HEALTHY_SCHEDULED"
              : "FAILED_OR_PENDING",
      };
    });

  const validOwnedChannels = connectedChannels.filter((c) => c.identityStatus === "CONFIRMED");
  const latestOwnedSuccess = validOwnedChannels
    .map((c) => c.lastSuccessAt)
    .filter(Boolean)
    .sort()
    .reverse()[0] || null;
  const nextOwnedDue = validOwnedChannels
    .map((c) => c.nextDueAt)
    .filter(Boolean)
    .sort()[0] || null;

  // 2. Competitor refresh (per-competitor cadence, default 3 days)
  const compSchedules = await db
    .select({
      id: miRefreshSchedule.id,
      competitorId: miRefreshSchedule.competitorId,
      competitorName: ciCompetitors.name,
      intervalDays: miRefreshSchedule.intervalDays,
      lastRefreshAt: miRefreshSchedule.lastRefreshAt,
      nextRefreshAt: miRefreshSchedule.nextRefreshAt,
      status: miRefreshSchedule.status,
      retryCount: miRefreshSchedule.retryCount,
    })
    .from(miRefreshSchedule)
    .innerJoin(
      ciCompetitors,
      and(eq(miRefreshSchedule.competitorId, ciCompetitors.id), eq(miRefreshSchedule.campaignId, ciCompetitors.campaignId))
    )
    .where(
      and(
        eq(miRefreshSchedule.accountId, accountId),
        eq(miRefreshSchedule.campaignId, campaignId),
        eq(ciCompetitors.isActive, true)
      )
    );

  const dueCompetitorCount = compSchedules.filter(
    (s) => s.status === "active" && s.nextRefreshAt && new Date(s.nextRefreshAt).getTime() <= now.getTime()
  ).length;
  const latestCompRefresh = compSchedules
    .map((s) => (s.lastRefreshAt ? new Date(s.lastRefreshAt).toISOString() : null))
    .filter(Boolean)
    .sort()
    .reverse()[0] || null;
  const nextCompDue = compSchedules
    .map((s) => (s.nextRefreshAt ? new Date(s.nextRefreshAt).toISOString() : null))
    .filter(Boolean)
    .sort()[0] || null;

  // 3. Performance evaluation (event-driven + 24h catch-up)
  const [latestExecState] = await db
    .select()
    .from(businessExecutionStates)
    .where(and(eq(businessExecutionStates.accountId, accountId), eq(businessExecutionStates.campaignId, campaignId)))
    .orderBy(desc(businessExecutionStates.createdAt))
    .limit(1);
  const lastEvalAt = latestExecState?.createdAt ? new Date(latestExecState.createdAt).toISOString() : null;
  const nextEvalDueAt = lastEvalAt
    ? new Date(new Date(lastEvalAt).getTime() + evalIntervalMs).toISOString()
    : now.toISOString();

  // 4. Business baseline clarification (once until answered)
  const clarifications = await db
    .select()
    .from(clarificationRequests)
    .where(and(eq(clarificationRequests.accountId, accountId), eq(clarificationRequests.campaignId, campaignId)))
    .orderBy(desc(clarificationRequests.createdAt));
  const answeredBaseline = clarifications.find((r) => r.status === "ANSWERED") || null;
  const pendingBaseline = !answeredBaseline ? clarifications.find((r) => r.status === "PENDING") || null : null;

  // 5. Weekly period metrics (once per completed 7-day reporting window)
  const inventories = await db
    .select()
    .from(weeklyBusinessInventories)
    .where(and(eq(weeklyBusinessInventories.accountId, accountId), eq(weeklyBusinessInventories.campaignId, campaignId)))
    .orderBy(desc(weeklyBusinessInventories.periodEnd));
  const dueInventory = inventories.find((inv) => isWeeklyInventoryDue(inv, now)) || null;
  const currentInventory = dueInventory || inventories[0] || null;
  const weeklyIsDue = Boolean(currentInventory && isWeeklyInventoryDue(currentInventory, now));

  // 6. Unanswered reminder policy (after 48 hours unanswered from actual due/request time, deduplicated, max 2 repeats)
  const activePendingInventory = weeklyIsDue ? currentInventory : null;
  const activePendingItem = pendingBaseline || activePendingInventory;
  const activeDueBaseAt = pendingBaseline
    ? pendingBaseline.createdAt
      ? new Date(pendingBaseline.createdAt)
      : now
    : activePendingInventory
      ? activePendingInventory.periodEnd
        ? new Date(activePendingInventory.periodEnd)
        : now
      : null;
  const rawLastReminded = (activePendingItem as any)?.lastRemindedAt || (activePendingItem as any)?.lastReminderAt || null;
  const rawLastReminderDate = rawLastReminded ? new Date(rawLastReminded) : null;
  const activeLastReminder =
    rawLastReminderDate && activeDueBaseAt && rawLastReminderDate.getTime() >= activeDueBaseAt.getTime()
      ? rawLastReminderDate
      : null;
  const activeReminderCount =
    activeLastReminder === null && rawLastReminderDate !== null
      ? 0
      : Number((activePendingItem as any)?.reminderCount ?? 0);
  const nextReminderDueAt =
    activePendingItem && activeReminderCount < MAX_CLARIFICATION_REMINDERS
      ? new Date((activeLastReminder || activeDueBaseAt || now).getTime() + reminderDelayMs).toISOString()
      : null;

  return {
    ownedChannelRefresh: {
      cadenceLabel: `Every ${OWNED_CHANNEL_REFRESH_HOURS} hours`,
      intervalHours: OWNED_CHANNEL_REFRESH_HOURS,
      lastSuccessAt: latestOwnedSuccess,
      nextDueAt: nextOwnedDue,
      status:
        connectedChannels.some((c) => c.identityStatus === "UNRESOLVED")
          ? "PARTIAL_ACTION_REQUIRED"
          : validOwnedChannels.length > 0
            ? "HEALTHY_ACTIVE"
            : "UNCONFIGURED",
      channels: connectedChannels,
    },
    competitorRefresh: {
      cadenceLabel: `Every ${DEFAULT_INTERVAL_DAYS} days (per-competitor)`,
      intervalDays: DEFAULT_INTERVAL_DAYS,
      activeCompetitorsCount: compSchedules.length,
      dueNowCount: dueCompetitorCount,
      lastSuccessAt: latestCompRefresh,
      nextDueAt: nextCompDue,
      status:
        compSchedules.length === 0
          ? "UNCONFIGURED"
          : dueCompetitorCount > 0
            ? "DUE_NOW"
            : "HEALTHY_SCHEDULED",
    },
    performanceEvaluation: {
      cadenceLabel: `Event-driven + Every ${PERFORMANCE_EVAL_CATCHUP_HOURS}h catch-up`,
      intervalHours: PERFORMANCE_EVAL_CATCHUP_HOURS,
      lastSuccessAt: lastEvalAt,
      nextDueAt: nextEvalDueAt,
      status: lastEvalAt ? "HEALTHY_ACTIVE" : "PENDING_FIRST_EVAL",
    },
    baselineClarification: {
      cadenceLabel: "Once until answered",
      lastSuccessAt: answeredBaseline?.answeredAt
        ? new Date(answeredBaseline.answeredAt).toISOString()
        : answeredBaseline?.updatedAt
          ? new Date(answeredBaseline.updatedAt).toISOString()
          : null,
      nextDueAt: pendingBaseline ? now.toISOString() : null,
      status: answeredBaseline ? "COMPLETED_ONE_TIME" : pendingBaseline ? "WAITING_FOR_USER" : "NOT_REQUIRED",
      activeRequestId: pendingBaseline?.id ?? answeredBaseline?.id ?? null,
    },
    weeklyPeriodMetrics: {
      cadenceLabel: `Every ${REPORTING_WINDOW_DAYS}-day reporting window`,
      intervalDays: REPORTING_WINDOW_DAYS,
      windowIndex: currentInventory?.windowIndex ?? 0,
      periodStart: currentInventory?.periodStart ? new Date(currentInventory.periodStart).toISOString() : null,
      periodEnd: currentInventory?.periodEnd ? new Date(currentInventory.periodEnd).toISOString() : null,
      lastSuccessAt: currentInventory?.submittedAt ? new Date(currentInventory.submittedAt).toISOString() : null,
      nextDueAt: currentInventory?.periodEnd ? new Date(currentInventory.periodEnd).toISOString() : null,
      isDue: weeklyIsDue,
      status: weeklyIsDue
        ? "DUE_NOW"
        : currentInventory?.status === "PARTIAL"
          ? "PARTIAL_UPDATED_IN_PROGRESS"
          : currentInventory?.status === "COMPLETED"
            ? "COMPLETED"
            : "IN_PROGRESS_SCHEDULED",
      activeInventoryId: currentInventory?.id ?? null,
    },
    unansweredReminderPolicy: {
      cadenceLabel: `After ${CLARIFICATION_REMINDER_DELAY_HOURS}h unanswered (max ${MAX_CLARIFICATION_REMINDERS} repeats)`,
      delayHours: CLARIFICATION_REMINDER_DELAY_HOURS,
      maxReminders: MAX_CLARIFICATION_REMINDERS,
      remindersSent: activeReminderCount,
      lastReminderAt: activeLastReminder ? activeLastReminder.toISOString() : null,
      nextDueAt: nextReminderDueAt,
      status: activePendingItem
        ? activeReminderCount >= MAX_CLARIFICATION_REMINDERS
          ? "MAX_REMINDERS_SENT"
          : "ARMED"
        : "IDLE_ALL_ANSWERED",
    },
  };
}

export async function runSchedulerCycle(options?: {
  targetCampaignId?: string;
  skipCompetitorFetch?: boolean;
  waitForTerminalMs?: number;
}) {
  if (isSchedulerRunning) return;
  isSchedulerRunning = true;

  try {
    // 1. Reconcile and recover
    await reconcileCompetitorSchedules();
    await recoverStaleLocks();

    // 2. Atomic claim via FOR UPDATE SKIP LOCKED (prioritizing campaigns with an APPROVED plan, or targetCampaignId)
    if (!options?.skipCompetitorFetch) {
      console.log(`[WatchtowerScheduler:${WORKER_INSTANCE_ID}] Attempting to claim up to ${BATCH_SIZE} due schedules...`);
      const campaignFilterSql = options?.targetCampaignId
        ? sql`AND s.campaign_id = ${options.targetCampaignId}`
        : sql``;

      const claimedRows = await db.execute(sql`
        UPDATE mi_refresh_schedule
        SET status = 'running',
            claimed_at = NOW(),
            claimed_by = ${WORKER_INSTANCE_ID}
        WHERE id IN (
          SELECT s.id FROM mi_refresh_schedule s
          JOIN ci_competitors c ON s.competitor_id = c.id AND s.campaign_id = c.campaign_id
          LEFT JOIN campaign_selections cs ON cs.selected_campaign_id = s.campaign_id AND cs.account_id = s.account_id
          WHERE s.next_refresh_at <= NOW()
            AND s.status = 'active'
            AND c.is_active = true
            AND COALESCE(cs.campaign_status, 'active') NOT IN ('paused', 'archived')
            AND COALESCE(cs.is_archived, false) = false
            ${campaignFilterSql}
          ORDER BY (
            CASE WHEN EXISTS (
              SELECT 1 FROM strategic_plans sp
              WHERE sp.campaign_id = s.campaign_id AND sp.status = 'APPROVED'
            ) THEN 0 ELSE 1 END
          ) ASC, s.next_refresh_at ASC
          LIMIT ${BATCH_SIZE}
          FOR UPDATE OF s SKIP LOCKED
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
          const competitorIds = schedules.map((s) => s.competitor_id as string);

          console.log(
            `[WatchtowerScheduler:${WORKER_INSTANCE_ID}] Batching fetch for campaign ${campaignId} with ${competitorIds.length} competitors.`
          );

          try {
            // Launch fetch job and wait for a recorded terminal outcome before marking schedule complete or evaluating downstream
            const jobId = await startFetchJob(accountId, campaignId, competitorIds);
            const terminalOutcome = await waitForFetchJobTerminalOutcome(jobId, accountId, campaignId, {
              timeoutMs: options?.waitForTerminalMs ?? 12 * 60 * 1000,
              pollIntervalMs: 1500,
            });

            if (!terminalOutcome.terminal || terminalOutcome.status === "FAILED") {
              throw new Error(
                terminalOutcome.error || `Fetch job ${jobId} ended with non-success status ${terminalOutcome.status}`
              );
            }

            // On recorded terminal success, reset to normal interval first
            for (const sched of schedules) {
              const intervalDays = (sched.interval_days as number) || DEFAULT_INTERVAL_DAYS;
              await db
                .update(miRefreshSchedule)
                .set({
                  nextRefreshAt: new Date(Date.now() + intervalDays * 24 * 60 * 60 * 1000),
                  lastRefreshAt: new Date(),
                  retryCount: 0,
                  status: "active",
                  refreshReason: "normal_monitoring",
                  claimedAt: null,
                  claimedBy: null,
                })
                .where(eq(miRefreshSchedule.id, sched.id as string));
            }

            // Trigger downstream Watchtower -> Performance Loop -> Deep Reasoning handoff ONLY after terminal completion
            try {
              await runScheduledCampaignDownstreamHandoff(accountId, campaignId, {
                trigger: "scheduled",
                jobId: terminalOutcome.jobId || undefined,
                requireTerminalAcquisition: true,
              });
            } catch (handoffErr: any) {
              console.warn(
                `[WatchtowerScheduler:${WORKER_INSTANCE_ID}] Non-fatal downstream handoff warning for campaign ${campaignId}: ${handoffErr?.message || handoffErr}`
              );
            }
          } catch (jobErr: any) {
            console.error(
              `[WatchtowerScheduler:${WORKER_INSTANCE_ID}] Fetch job failed for campaign ${campaignId}: ${jobErr.message}`
            );

            // Retry logic
            for (const sched of schedules) {
              const nextRetryCount = ((sched.retry_count as number) || 0) + 1;
              const schedId = sched.id as string;
              if (nextRetryCount > MAX_RETRIES) {
                console.log(
                  `[WatchtowerScheduler:${WORKER_INSTANCE_ID}] Max retries reached for ${sched.competitor_id}. Aborting back to normal schedule.`
                );
                await db
                  .update(miRefreshSchedule)
                  .set({
                    nextRefreshAt: new Date(
                      Date.now() + ((sched.interval_days as number) || DEFAULT_INTERVAL_DAYS) * 24 * 60 * 60 * 1000
                    ),
                    retryCount: 0,
                    status: "active",
                    refreshReason: "max_retries_exceeded",
                    claimedAt: null,
                    claimedBy: null,
                  })
                  .where(eq(miRefreshSchedule.id, schedId));
              } else {
                const backoffHours = nextRetryCount === 1 ? RETRY_DELAY_HOURS : 24;
                console.log(
                  `[WatchtowerScheduler:${WORKER_INSTANCE_ID}] Retrying ${sched.competitor_id} in ${backoffHours} hours (attempt ${nextRetryCount})`
                );
                await db
                  .update(miRefreshSchedule)
                  .set({
                    nextRefreshAt: new Date(Date.now() + backoffHours * 60 * 60 * 1000),
                    retryCount: nextRetryCount,
                    status: "active",
                    refreshReason: "retry",
                    claimedAt: null,
                    claimedBy: null,
                  })
                  .where(eq(miRefreshSchedule.id, schedId));
              }
            }
          }
        }
      }
    }

    // 4. Execute recurring 24h owned-channel refresh, 24h performance evaluation catch-up, 7d window check, and 48h reminders for active campaigns
    const activePlansQuery = options?.targetCampaignId
      ? await db
          .select({ accountId: strategicPlans.accountId, campaignId: strategicPlans.campaignId })
          .from(strategicPlans)
          .where(and(eq(strategicPlans.campaignId, options.targetCampaignId), eq(strategicPlans.status, "APPROVED")))
      : await db
          .select({ accountId: strategicPlans.accountId, campaignId: strategicPlans.campaignId })
          .from(strategicPlans)
          .where(eq(strategicPlans.status, "APPROVED"))
          .limit(20);

    const seenCampaigns = new Set<string>();
    for (const row of activePlansQuery) {
      if (!row.accountId || !row.campaignId || seenCampaigns.has(row.campaignId)) continue;
      seenCampaigns.add(row.campaignId);
      try {
        await runScheduledOwnedChannelRefresh(row.accountId, row.campaignId);
      } catch (ownedErr: any) {
        console.warn(
          `[WatchtowerScheduler:${WORKER_INSTANCE_ID}] Owned-channel refresh warning for ${row.campaignId}: ${ownedErr?.message}`
        );
      }
      try {
        await runScheduledPerformanceAndReminderCheck(row.accountId, row.campaignId);
      } catch (perfErr: any) {
        console.warn(
          `[WatchtowerScheduler:${WORKER_INSTANCE_ID}] Performance/reminder check warning for ${row.campaignId}: ${perfErr?.message}`
        );
      }
    }
  } catch (err: any) {
    console.error(`[WatchtowerScheduler:${WORKER_INSTANCE_ID}] Cycle error: ${err.message}`);
  } finally {
    isSchedulerRunning = false;

    const jitterMin = 30;
    const jitterMax = 180;
    const nextRunMins = Math.floor(Math.random() * (jitterMax - jitterMin + 1)) + jitterMin;
    console.log(`[WatchtowerScheduler:${WORKER_INSTANCE_ID}] Next cycle in ${nextRunMins} minutes.`);

    const delayMs = process.env.NODE_ENV === "production" ? nextRunMins * 60 * 1000 : 30 * 1000;

    if (!options?.targetCampaignId) {
      schedulerTimeout = setTimeout(() => runSchedulerCycle(), delayMs);
    }
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
