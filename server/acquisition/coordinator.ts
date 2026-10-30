/**
 * Campaign Acquisition Coordinator (Task #71)
 *
 * Implements durable parallel acquisition coordination across Instagram,
 * TikTok, YouTube, Google Reviews, Websites, and Market Voice search quotes.
 *
 * Guarantees:
 * 1. Bounded Parallelism: Max 3 concurrent network tasks per campaign run.
 * 2. Atomic Lease Claiming: FOR UPDATE SKIP LOCKED prevents double-fetching.
 * 3. Fencing Tokens: Monotonically increasing tokens reject stale worker completions.
 * 4. Lease Expiration: 10-minute lease automatically recovers from crashed workers.
 * 5. Deterministic Task Keys: Idempotent task creation prevents duplicate work.
 * 6. Frozen Evidence Manifest: Downstream strategy analysis runs strictly on
 *    the immutable snapshot of evidence IDs frozen when acquisition concludes.
 */

import { createHash, randomUUID } from "crypto";
import { db } from "../db";
import {
  acquisitionTasks,
  acquisitionRequests,
  evidenceManifests,
  ciCompetitors,
  ciCompetitorPosts,
  ciCompetitorComments,
  ciCompetitorReviews,
  competitorSources,
  marketVoiceEvidence,
  competitorWebsiteSnapshots,
  competitorUnderstandingSnapshots,
  websiteSnapshots,
  businessUnderstandingSnapshots,
  offeringInputEvidence,
  type AcquisitionTask,
  type EvidenceManifest,
} from "@shared/schema";
import { eq, and, or, sql, desc, inArray } from "drizzle-orm";
import {
  type CanonicalAuthoritativeContext,
  resolveCanonicalContext,
} from "../discovery/context-binder";
import { extractExternalAccountId } from "../competitive-intelligence/source-discovery";
import {
  executeClaimedAuthorityTask,
  inferDefaultProviderAndActor,
} from "./authority";

export interface PlanTasksOptions {
  forceRefresh?: boolean;
  cycleToken?: string;
  orchestrationJobId?: string;
  requesterEngine?: string;
  trigger?: string;
}

export interface AcquisitionBatchOptions {
  forceRefresh?: boolean;
  concurrencyLimit?: number;
  batchDeadlineMs?: number;
  maxTasksPerBatch?: number;
  orchestrationJobId?: string;
  requesterEngine?: string;
  trigger?: string;
  skipNetworkInTests?: boolean;
}

export interface AcquisitionBatchSummary {
  totalTasksPlanned: number;
  completedTasks: number;
  failedTasks: number;
  skippedTasks: number;
  durationMs: number;
  taskResults: Record<string, { status: string; error?: string; output?: any }>;
}

export interface ClaimedTask {
  task: AcquisitionTask;
  fencingToken: number;
}

export interface EvidencePoolCounts {
  primaryMarketVoice: number;
  supportingSocialVoice: number;
  benchmarkContext: number;
  totalUnits: number;
  totalCustomerVoiceUnits?: number;
  totalAllEvidenceUnits?: number;
  unitCountMeaning?: string;
}

export interface SourceDiversityReport {
  instagramPosts: number;
  tiktokPosts: number;
  youtubePosts: number;
  instagramComments: number;
  googleReviews: number;
  trustpilotReviews?: number;
  totalReviews?: number;
  marketVoiceQuotes: number;
  webSnapshots: number;
  competitorsCovered: number;
}

export function buildCompetitorAcquisitionTaskDefinitions(
  comp: { id: string; name: string; websiteUrl?: string | null },
  sources: Array<{
    id: string;
    platform: string;
    canonicalUrl: string;
    externalAccountId?: string | null;
  }>,
  campaignId: string,
  accountId: string,
  cycleToken = "default"
): Array<{
  id: string;
  campaignId: string;
  accountId: string;
  sourcePlatform: string;
  entityType: string;
  entityId: string;
  taskKey: string;
  taskType: string;
  status: string;
  priority: number;
  inputPayload: Record<string, any>;
}> {
  const definitions: Array<{
    id: string;
    campaignId: string;
    accountId: string;
    sourcePlatform: string;
    entityType: string;
    entityId: string;
    taskKey: string;
    taskType: string;
    status: string;
    priority: number;
    inputPayload: Record<string, any>;
  }> = [];

  // A. Instagram tasks (supports multiple legitimate accounts per competitor)
  const igSources = sources.filter((s) => s.platform.toUpperCase() === "INSTAGRAM" && s.canonicalUrl);
  for (let idx = 0; idx < igSources.length; idx++) {
    const igSource = igSources[idx];
    const handle = igSource.externalAccountId || extractExternalAccountId("instagram", igSource.canonicalUrl);
    if (!handle) continue;
    const suffix = idx === 0 ? "POSTS" : `POSTS:${igSource.id}`;
    const taskKey = `${campaignId}:${cycleToken}:INSTAGRAM:${comp.id}:${suffix}`;
    const id = `acq_${createHash("sha256").update(taskKey).digest("hex").slice(0, 16)}`;
    definitions.push({
      id,
      campaignId,
      accountId,
      sourcePlatform: "INSTAGRAM",
      entityType: "COMPETITOR",
      entityId: comp.id,
      taskKey,
      taskType: "POSTS",
      status: "PENDING",
      priority: 100,
      inputPayload: {
        competitorId: comp.id,
        sourceId: igSource.id,
        canonicalUrl: igSource.canonicalUrl,
        handle,
      },
    });

    if (idx === 0) {
      const commentsTaskKey = `${campaignId}:${cycleToken}:INSTAGRAM:${comp.id}:COMMENTS`;
      const commentsId = `acq_${createHash("sha256").update(commentsTaskKey).digest("hex").slice(0, 16)}`;
      definitions.push({
        id: commentsId,
        campaignId,
        accountId,
        sourcePlatform: "INSTAGRAM",
        entityType: "COMPETITOR",
        entityId: comp.id,
        taskKey: commentsTaskKey,
        taskType: "COMMENTS",
        status: "PENDING",
        priority: 80,
        inputPayload: { competitorId: comp.id, sourceId: igSource.id, maxPosts: 3, maxCommentsPerPost: 10, dependsOn: id },
      });
    }
  }

  // B. TikTok tasks (supports multiple legitimate accounts per competitor and extracts handle from canonicalUrl when externalAccountId is unset)
  const ttSources = sources.filter((s) => s.platform.toUpperCase() === "TIKTOK" && s.canonicalUrl);
  for (let idx = 0; idx < ttSources.length; idx++) {
    const ttSource = ttSources[idx];
    const handle = ttSource.externalAccountId || extractExternalAccountId("tiktok", ttSource.canonicalUrl);
    if (!handle) continue;
    const suffix = idx === 0 ? "POSTS" : `POSTS:${ttSource.id}`;
    const taskKey = `${campaignId}:${cycleToken}:TIKTOK:${comp.id}:${suffix}`;
    const id = `acq_${createHash("sha256").update(taskKey).digest("hex").slice(0, 16)}`;
    definitions.push({
      id,
      campaignId,
      accountId,
      sourcePlatform: "TIKTOK",
      entityType: "COMPETITOR",
      entityId: comp.id,
      taskKey,
      taskType: "POSTS",
      status: "PENDING",
      priority: 90,
      inputPayload: {
        competitorId: comp.id,
        sourceId: ttSource.id,
        canonicalUrl: ttSource.canonicalUrl,
        handle,
      },
    });
  }

  // C. YouTube tasks (uses verified channelUrl + sourceId instead of generic competitor name search)
  const ytSources = sources.filter((s) => s.platform.toUpperCase() === "YOUTUBE" && s.canonicalUrl);
  for (let idx = 0; idx < ytSources.length; idx++) {
    const ytSource = ytSources[idx];
    const suffix = idx === 0 ? "POSTS" : `POSTS:${ytSource.id}`;
    const taskKey = `${campaignId}:${cycleToken}:YOUTUBE:${comp.id}:${suffix}`;
    const id = `acq_${createHash("sha256").update(taskKey).digest("hex").slice(0, 16)}`;
    definitions.push({
      id,
      campaignId,
      accountId,
      sourcePlatform: "YOUTUBE",
      entityType: "COMPETITOR",
      entityId: comp.id,
      taskKey,
      taskType: "POSTS",
      status: "PENDING",
      priority: 85,
      inputPayload: {
        competitorId: comp.id,
        sourceId: ytSource.id,
        channelUrl: ytSource.canonicalUrl,
        canonicalUrl: ytSource.canonicalUrl,
        query: comp.name,
      },
    });
  }

  // D. Verified Review tasks (ONLY schedule when a verified review source with a valid URL exists)
  const revSources = sources.filter(
    (s) => ["GOOGLE", "GOOGLE_REVIEWS", "TRUSTPILOT", "REVIEWS"].includes(s.platform.toUpperCase()) && s.canonicalUrl
  );
  for (let idx = 0; idx < revSources.length; idx++) {
    const revSource = revSources[idx];
    const isTrustpilot = revSource.platform.toUpperCase() === "TRUSTPILOT" || revSource.canonicalUrl.includes("trustpilot.com");
    const platName = isTrustpilot ? "TRUSTPILOT" : "GOOGLE_REVIEWS";
    const suffix = idx === 0 ? "REVIEWS" : `REVIEWS:${revSource.id}`;
    const taskKey = `${campaignId}:${cycleToken}:${platName}:${comp.id}:${suffix}`;
    const id = `acq_${createHash("sha256").update(taskKey).digest("hex").slice(0, 16)}`;
    definitions.push({
      id,
      campaignId,
      accountId,
      sourcePlatform: platName,
      entityType: "COMPETITOR",
      entityId: comp.id,
      taskKey,
      taskType: "REVIEWS",
      status: "PENDING",
      priority: 75,
      inputPayload: {
        competitorId: comp.id,
        sourceId: revSource.id,
        targetUrl: revSource.canonicalUrl,
        googleMapsUrl: isTrustpilot ? null : revSource.canonicalUrl,
        platformType: isTrustpilot ? "trustpilot" : "google_maps",
        competitorName: comp.name,
      },
    });
  }

  // E. Website Understanding tasks
  const webSource = sources.find((s) => s.platform === "WEBSITE");
  const targetWebUrl = webSource?.canonicalUrl || comp.websiteUrl;
  if (targetWebUrl) {
    const taskKey = `${campaignId}:${cycleToken}:COMPETITOR_WEBSITE:${comp.id}:UNDERSTANDING`;
    const id = `acq_${createHash("sha256").update(taskKey).digest("hex").slice(0, 16)}`;
    definitions.push({
      id,
      campaignId,
      accountId,
      sourcePlatform: "COMPETITOR_WEBSITE",
      entityType: "COMPETITOR",
      entityId: comp.id,
      taskKey,
      taskType: "UNDERSTANDING",
      status: "PENDING",
      priority: 88,
      inputPayload: {
        competitorId: comp.id,
        competitorName: comp.name,
        websiteUrl: targetWebUrl,
      },
    });
  }

  return definitions;
}

/**
 * Plans idempotent acquisition tasks for all verified competitors and market voice sources,
 * ordering competitors fairly by oldest `lastCheckedAt` first and recording an
 * `acquisition_requests` lineage entry for every task.
 */
export async function planAcquisitionTasks(
  canonicalContext: CanonicalAuthoritativeContext,
  options: PlanTasksOptions = {}
): Promise<{ tasksPlanned: number; taskIds: string[] }> {
  const { accountId, campaignId } = canonicalContext;
  const cycleToken = options.cycleToken || options.orchestrationJobId || "default";
  const requesterEngine = options.requesterEngine || "STRATEGY_ORCHESTRATOR";
  const trigger = options.trigger || "STRATEGY_GENERATION";

  // 1. Fetch active competitors ordered fairly: never-checked / oldest-checked first
  const competitors = await db
    .select()
    .from(ciCompetitors)
    .where(and(
      eq(ciCompetitors.accountId, accountId),
      eq(ciCompetitors.campaignId, campaignId),
      eq(ciCompetitors.isActive, true)
    ))
    .orderBy(sql`COALESCE(${ciCompetitors.lastCheckedAt}, '1970-01-01'::timestamp) ASC`, ciCompetitors.createdAt);

  const plannedTaskIds: string[] = [];

  for (let compIndex = 0; compIndex < competitors.length; compIndex++) {
    const comp = competitors[compIndex];
    // Fair priority boost for previously unchecked/deferred competitors so they never starve
    const fairnessBoost = comp.lastCheckedAt ? Math.max(0, 10 - compIndex) : 20;

    // Fetch registered sources for this competitor
    const sources = await db
      .select()
      .from(competitorSources)
      .where(and(
        eq(competitorSources.accountId, accountId),
        eq(competitorSources.campaignId, campaignId),
        eq(competitorSources.competitorId, comp.id),
        or(eq(competitorSources.status, "ACTIVE"), eq(competitorSources.status, "VERIFIED"))
      ));

    const defs = buildCompetitorAcquisitionTaskDefinitions(comp, sources, campaignId, accountId, cycleToken);
    for (const def of defs) {
      const inferred = inferDefaultProviderAndActor(def.sourcePlatform, def.taskType);
      const enrichedDef = {
        ...def,
        priority: def.priority + fairnessBoost,
        sourceId: def.inputPayload.sourceId || null,
        canonicalUrl:
          def.inputPayload.canonicalUrl ||
          def.inputPayload.websiteUrl ||
          def.inputPayload.channelUrl ||
          def.inputPayload.targetUrl ||
          null,
        externalAccountId: def.inputPayload.handle || null,
        capability: def.taskType,
        provider: inferred.provider,
        actorId: inferred.actorId,
      };

      await db
        .insert(acquisitionTasks)
        .values(enrichedDef as any)
        .onConflictDoNothing();

      // Record consumer request in acquisition_requests
      const reqId = `areq_${createHash("sha256").update(`req:${def.taskKey}:${requesterEngine}`).digest("hex").slice(0, 20)}`;
      await db
        .insert(acquisitionRequests)
        .values({
          id: reqId,
          accountId,
          campaignId,
          requesterEngine,
          trigger,
          parentJobId: options.orchestrationJobId || null,
          entityType: def.entityType,
          entityId: def.entityId,
          sourceId: enrichedDef.sourceId,
          platform: def.sourcePlatform,
          canonicalUrl: enrichedDef.canonicalUrl,
          externalAccountId: enrichedDef.externalAccountId,
          capability: def.taskType,
          taskId: def.id,
          resolutionType: "NEW_FETCH",
          status: "PENDING",
          provider: inferred.provider,
          actorId: inferred.actorId,
          consumerDeliveryStatus: "PENDING",
        })
        .onConflictDoNothing();

      plannedTaskIds.push(def.id);
    }
  }

  // 2. Market Voice Quote Search Task
  const mvTaskKey = `${campaignId}:${cycleToken}:MARKET_VOICE:PRIMARY:SEARCH_QUOTES`;
  const mvId = `acq_${createHash("sha256").update(mvTaskKey).digest("hex").slice(0, 16)}`;
  const mvInferred = inferDefaultProviderAndActor("MARKET_VOICE", "SEARCH_QUOTES");
  await db
    .insert(acquisitionTasks)
    .values({
      id: mvId,
      campaignId,
      accountId,
      sourcePlatform: "MARKET_VOICE",
      entityType: "MARKET_INTENT",
      entityId: "primary_intent",
      capability: "SEARCH_QUOTES",
      provider: mvInferred.provider,
      actorId: mvInferred.actorId,
      taskKey: mvTaskKey,
      taskType: "SEARCH_QUOTES",
      status: "PENDING",
      priority: 130, // highest priority
      inputPayload: {
        category: canonicalContext.category,
        heroProduct: canonicalContext.offeringName,
        targetMarket: canonicalContext.targetMarket,
        targetLanguage: canonicalContext.targetLanguage,
      },
    })
    .onConflictDoNothing();

  const mvReqId = `areq_${createHash("sha256").update(`req:${mvTaskKey}:${requesterEngine}`).digest("hex").slice(0, 20)}`;
  await db
    .insert(acquisitionRequests)
    .values({
      id: mvReqId,
      accountId,
      campaignId,
      requesterEngine,
      trigger,
      parentJobId: options.orchestrationJobId || null,
      entityType: "MARKET_INTENT",
      entityId: "primary_intent",
      platform: "MARKET_VOICE",
      capability: "SEARCH_QUOTES",
      taskId: mvId,
      resolutionType: "NEW_FETCH",
      status: "PENDING",
      provider: mvInferred.provider,
      actorId: mvInferred.actorId,
      consumerDeliveryStatus: "PENDING",
    })
    .onConflictDoNothing();

  plannedTaskIds.push(mvId);

  return { tasksPlanned: plannedTaskIds.length, taskIds: plannedTaskIds };
}

/**
 * Atomically claims the highest priority pending, deferred, or expired task using FOR UPDATE SKIP LOCKED.
 */
export async function claimNextTask(
  workerId: string,
  campaignId: string
): Promise<ClaimedTask | null> {
  const query = sql`
    UPDATE acquisition_tasks
    SET status = 'RUNNING',
        lease_owner = ${workerId},
        heartbeat_at = NOW(),
        leased_until = NOW() + INTERVAL '10 minutes',
        fencing_token = fencing_token + 1,
        started_at = COALESCE(started_at, NOW()),
        updated_at = NOW()
    WHERE id = (
      SELECT id FROM acquisition_tasks
      WHERE campaign_id = ${campaignId}
        AND (status = 'PENDING' OR status = 'DEFERRED' OR (status = 'RUNNING' AND leased_until < NOW()))
        AND (next_retry_at IS NULL OR next_retry_at <= NOW())
        AND retry_count <= max_retries
      ORDER BY CASE WHEN status = 'DEFERRED' THEN 1 ELSE 0 END DESC,
               priority DESC,
               COALESCE(next_retry_at, created_at) ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING *;
  `;

  const result = await db.execute(query);
  const rows = (result as any)?.rows || (result as any) || [];
  if (rows.length === 0) return null;

  const raw = rows[0];
  const [hydrated] = await db
    .select()
    .from(acquisitionTasks)
    .where(eq(acquisitionTasks.id, raw.id))
    .limit(1);

  if (hydrated) {
    return { task: hydrated, fencingToken: hydrated.fencingToken };
  }

  const task: AcquisitionTask = {
    id: raw.id,
    campaignId: raw.campaign_id,
    accountId: raw.account_id,
    sourcePlatform: raw.source_platform,
    entityType: raw.entity_type,
    entityId: raw.entity_id,
    sourceId: raw.source_id || null,
    canonicalUrl: raw.canonical_url || null,
    externalAccountId: raw.external_account_id || null,
    capability: raw.capability || null,
    provider: raw.provider || "APIFY",
    actorId: raw.actor_id || null,
    providerRunId: raw.provider_run_id || null,
    datasetId: raw.dataset_id || null,
    taskKey: raw.task_key,
    taskType: raw.task_type,
    status: raw.status,
    terminalOutcome: raw.terminal_outcome || null,
    errorCode: raw.error_code || null,
    priority: raw.priority,
    leaseOwner: raw.lease_owner,
    heartbeatAt: raw.heartbeat_at ? new Date(raw.heartbeat_at) : null,
    leasedUntil: raw.leased_until ? new Date(raw.leased_until) : null,
    fencingToken: raw.fencing_token,
    retryCount: raw.retry_count,
    maxRetries: raw.max_retries,
    nextRetryAt: raw.next_retry_at ? new Date(raw.next_retry_at) : null,
    nextPageCursor: raw.next_page_cursor || null,
    timeWindowDays: raw.time_window_days ?? null,
    itemLimit: raw.item_limit ?? null,
    freshnessTtlSec: raw.freshness_ttl_sec ?? null,
    usageUsd: raw.usage_usd ?? null,
    inputPayload: raw.input_payload,
    outputSummary: raw.output_summary,
    errorMessage: raw.error_message,
    startedAt: raw.started_at ? new Date(raw.started_at) : null,
    completedAt: raw.completed_at ? new Date(raw.completed_at) : null,
    createdAt: new Date(raw.created_at),
    updatedAt: new Date(raw.updated_at),
  };

  return { task, fencingToken: task.fencingToken };
}

/**
 * Completes a task atomically verifying fencing token.
 */
export async function completeTask(
  taskId: string,
  fencingToken: number,
  outputSummary: any
): Promise<boolean> {
  const query = sql`
    UPDATE acquisition_tasks
    SET status = 'COMPLETED',
        output_summary = ${JSON.stringify(outputSummary)}::jsonb,
        completed_at = NOW(),
        updated_at = NOW()
    WHERE id = ${taskId} AND fencing_token = ${fencingToken};
  `;
  const result = await db.execute(query);
  const rowCount = (result as any)?.rowCount ?? 1;
  return rowCount > 0;
}

/**
 * Fails a task atomically with retry increment or marks rate-limited.
 */
export async function failTask(
  taskId: string,
  fencingToken: number,
  errorMessage: string,
  isRateLimited = false
): Promise<boolean> {
  const isNonRetryableConfigError = /\b(apify api 404|actor was not found|actor not found|configuration_error|invalid actor|runactorandgetitems: actorid is required)\b/i.test(
    String(errorMessage || "")
  );
  const query = sql`
    UPDATE acquisition_tasks
    SET status = CASE 
          WHEN ${isRateLimited} THEN 'RATE_LIMITED'
          WHEN ${isNonRetryableConfigError} THEN 'FAILED'
          WHEN retry_count + 1 > max_retries THEN 'FAILED'
          ELSE 'PENDING'
        END,
        retry_count = retry_count + 1,
        error_message = ${errorMessage},
        updated_at = NOW()
    WHERE id = ${taskId} AND fencing_token = ${fencingToken};
  `;
  const result = await db.execute(query);
  const rowCount = (result as any)?.rowCount ?? 1;
  return rowCount > 0;
}

/**
 * Freezes the evidence manifest for an orchestration run, capturing the exact set
 * of post, comment, review, and quote IDs available.
 */
export async function freezeEvidenceManifest(params: {
  campaignId: string;
  accountId: string;
  orchestrationJobId: string;
  contextFingerprint: string;
}): Promise<EvidenceManifest> {
  const { campaignId, accountId, orchestrationJobId, contextFingerprint } = params;

  // 1. Gather active competitor IDs under this campaign
  const comps = await db
    .select({ id: ciCompetitors.id })
    .from(ciCompetitors)
    .where(and(
      eq(ciCompetitors.accountId, accountId),
      eq(ciCompetitors.campaignId, campaignId),
      eq(ciCompetitors.isActive, true)
    ));
  const compIds = comps.map((c) => c.id);

  let posts: any[] = [];
  let comments: any[] = [];
  if (compIds.length > 0) {
    posts = await db
      .select({ id: ciCompetitorPosts.id, platform: ciCompetitorPosts.platform, competitorId: ciCompetitorPosts.competitorId })
      .from(ciCompetitorPosts)
      .where(and(
        eq(ciCompetitorPosts.accountId, accountId),
        inArray(ciCompetitorPosts.competitorId, compIds)
      ));

    comments = await db
      .select({ id: ciCompetitorComments.id })
      .from(ciCompetitorComments)
      .where(and(
        eq(ciCompetitorComments.accountId, accountId),
        inArray(ciCompetitorComments.competitorId, compIds)
      ));
  }

  // 3. Gather review IDs
  const reviews = await db
    .select({ id: ciCompetitorReviews.id, platform: ciCompetitorReviews.platform })
    .from(ciCompetitorReviews)
    .where(and(
      eq(ciCompetitorReviews.accountId, accountId),
      eq(ciCompetitorReviews.campaignId, campaignId)
    ));

  // 4. Gather Market Voice quote IDs
  const mvQuotes = await db
    .select({
      id: marketVoiceEvidence.id,
      semanticScope: marketVoiceEvidence.semanticScope,
      eligibilityVerdict: marketVoiceEvidence.eligibilityVerdict,
    })
    .from(marketVoiceEvidence)
    .where(and(
      eq(marketVoiceEvidence.accountId, accountId),
      eq(marketVoiceEvidence.campaignId, campaignId)
    ));

  // 5. Gather web snapshot IDs and content hashes
  const webSnaps = await db
    .select({ id: competitorWebsiteSnapshots.id })
    .from(competitorWebsiteSnapshots)
    .where(and(
      eq(competitorWebsiteSnapshots.accountId, accountId),
      eq(competitorWebsiteSnapshots.campaignId, campaignId)
    ));

  const firstPartyWeb = await db
    .select({
      id: websiteSnapshots.id,
      contentHash: websiteSnapshots.contentHash,
      rawPages: websiteSnapshots.pagesCrawled,
    })
    .from(websiteSnapshots)
    .where(and(
      eq(websiteSnapshots.accountId, accountId),
      eq(websiteSnapshots.campaignId, campaignId)
    ))
    .orderBy(desc(websiteSnapshots.createdAt));

  const cuSnaps = compIds.length > 0
    ? await db
        .select({
          id: competitorUnderstandingSnapshots.id,
          competitorId: competitorUnderstandingSnapshots.competitorId,
          websiteSnapshotId: competitorUnderstandingSnapshots.competitorWebsiteSnapshotId,
          status: competitorUnderstandingSnapshots.status,
        })
        .from(competitorUnderstandingSnapshots)
        .where(and(
          eq(competitorUnderstandingSnapshots.accountId, accountId),
          eq(competitorUnderstandingSnapshots.campaignId, campaignId),
          inArray(competitorUnderstandingSnapshots.competitorId, compIds)
        ))
        .orderBy(desc(competitorUnderstandingSnapshots.createdAt))
    : [];

  const [latestBuSnap] = await db
    .select({
      id: businessUnderstandingSnapshots.id,
      websiteSnapshotId: businessUnderstandingSnapshots.websiteSnapshotId,
      offeringInputEvidenceId: businessUnderstandingSnapshots.offeringInputEvidenceId,
      campaignOfferingId: businessUnderstandingSnapshots.campaignOfferingId,
    })
    .from(businessUnderstandingSnapshots)
    .where(and(
      eq(businessUnderstandingSnapshots.accountId, accountId),
      eq(businessUnderstandingSnapshots.campaignId, campaignId),
      eq(businessUnderstandingSnapshots.status, "COMPLETE")
    ))
    .orderBy(desc(businessUnderstandingSnapshots.createdAt))
    .limit(1);

  const [offeringEv] = latestBuSnap?.offeringInputEvidenceId
    ? await db
        .select({
          id: offeringInputEvidence.id,
          contentHash: offeringInputEvidence.contentHash,
        })
        .from(offeringInputEvidence)
        .where(and(
          eq(offeringInputEvidence.id, latestBuSnap.offeringInputEvidenceId),
          eq(offeringInputEvidence.accountId, accountId)
        ))
        .limit(1)
    : [null];

  const allWebSnapshotIds = [
    ...webSnaps.map((w) => w.id),
    ...firstPartyWeb.map((w) => w.id),
  ];

  // 6. Build diversity report & evidence pool counts
  const igPosts = posts.filter((p) => p.platform?.toLowerCase() === "instagram").length;
  const ttPosts = posts.filter((p) => p.platform?.toLowerCase() === "tiktok").length;
  const ytPosts = posts.filter((p) => p.platform?.toLowerCase() === "youtube").length;
  const fbPosts = posts.filter((p) => p.platform?.toLowerCase() === "facebook").length;
  const liPosts = posts.filter((p) => p.platform?.toLowerCase() === "linkedin").length;
  const xPosts = posts.filter((p) => p.platform?.toLowerCase() === "x").length;
  const blogPosts = posts.filter((p) => p.platform?.toLowerCase() === "blog").length;
  const googleSearchPosts = posts.filter((p) => p.platform?.toLowerCase() === "google").length;
  const uniqueComps = new Set([
    ...posts.map((p) => p.competitorId),
    ...cuSnaps.map((c) => c.competitorId),
  ]).size;

  const firstPartyWebPrimary = firstPartyWeb[0] || null;
  const firstPartyPageHashes = Array.isArray(firstPartyWebPrimary?.rawPages)
    ? (firstPartyWebPrimary.rawPages as any[]).map((p: any) => ({
        businessEvidenceId: p.businessEvidenceId || null,
        sourceUrl: p.sourceUrl || null,
        pageType: p.pageType || null,
        contentHash: p.contentHash || null,
      }))
    : [];

  const googleReviewCount = reviews.filter((r) => r.platform?.toLowerCase().includes("google")).length;
  const trustpilotReviewCount = reviews.filter((r) => r.platform?.toLowerCase().includes("trustpilot")).length;
  const otherReviewCount = Math.max(0, reviews.length - googleReviewCount - trustpilotReviewCount);

  const sourceDiversityReport: SourceDiversityReport & Record<string, any> = {
    instagramPosts: igPosts,
    tiktokPosts: ttPosts,
    youtubePosts: ytPosts,
    facebookPosts: fbPosts,
    linkedinPosts: liPosts,
    xPosts,
    blogPosts,
    googleSearchPosts,
    totalPosts: posts.length,
    instagramComments: comments.length,
    googleReviews: googleReviewCount,
    trustpilotReviews: trustpilotReviewCount,
    otherReviews: otherReviewCount,
    totalReviews: reviews.length,
    marketVoiceQuotes: mvQuotes.length,
    webSnapshots: allWebSnapshotIds.length,
    competitorsCovered: uniqueComps,
    competitorUnderstandingSnapshotIds: cuSnaps.filter((c) => c.status === "COMPLETE").map((c) => c.id),
    businessUnderstandingSnapshotId: latestBuSnap?.id || null,
    firstPartyWebsiteSnapshotId: firstPartyWebPrimary?.id || null,
    firstPartyWebsiteContentHash: firstPartyWebPrimary?.contentHash || null,
    firstPartyPageHashes,
    offeringInputEvidenceId: offeringEv?.id || latestBuSnap?.offeringInputEvidenceId || null,
    offeringInputContentHash: offeringEv?.contentHash || null,
  };

  const primaryMarketVoiceCount = mvQuotes.filter(
    (q) => q.eligibilityVerdict === "PRIMARY_ELIGIBLE" || q.semanticScope === "CATEGORY_RECURRING"
  ).length;
  const supportingSocialVoiceCount = comments.length + reviews.length;
  const benchmarkContextCount = mvQuotes.filter(
    (q) => q.semanticScope === "MARKET_TRANSFERABLE"
  ).length;
  const customerVoiceTotal = mvQuotes.length + comments.length + reviews.length;
  const allEvidenceTotal =
    posts.length +
    comments.length +
    reviews.length +
    mvQuotes.length +
    allWebSnapshotIds.length;

  const evidencePoolCounts: EvidencePoolCounts = {
    primaryMarketVoice: primaryMarketVoiceCount,
    supportingSocialVoice: supportingSocialVoiceCount,
    benchmarkContext: benchmarkContextCount,
    totalUnits: allEvidenceTotal,
    totalCustomerVoiceUnits: customerVoiceTotal,
    totalAllEvidenceUnits: allEvidenceTotal,
    unitCountMeaning: "totalUnits_is_all_evidence_units_matching_sourceDiversityReport;totalCustomerVoiceUnits_is_mvQuotes_plus_comments_plus_reviews",
  };

  const manifestId = `evm_${createHash("sha256").update(`${orchestrationJobId}:${contextFingerprint}:${Date.now()}`).digest("hex").slice(0, 20)}`;

  const [manifest] = await db
    .insert(evidenceManifests)
    .values({
      id: manifestId,
      campaignId,
      accountId,
      orchestrationJobId,
      contextFingerprint,
      manifestVersion: 1,
      status: "FROZEN",
      includedPostIds: posts.map((p) => p.id),
      includedCommentIds: comments.map((c) => c.id),
      includedReviewIds: reviews.map((r) => r.id),
      includedMarketVoiceIds: mvQuotes.map((q) => q.id),
      includedWebSnapshotIds: allWebSnapshotIds,
      evidencePoolCounts: evidencePoolCounts as any,
      sourceDiversityReport: sourceDiversityReport as any,
    })
    .returning();

  return manifest;
}

/**
 * Retrieves the frozen evidence manifest for an orchestration job.
 */
export async function getFrozenManifest(
  orchestrationJobId: string
): Promise<EvidenceManifest | null> {
  const [manifest] = await db
    .select()
    .from(evidenceManifests)
    .where(eq(evidenceManifests.orchestrationJobId, orchestrationJobId))
    .limit(1);

  return manifest || null;
}

/**
 * Checks whether the campaign already has persisted multi-source evidence
 * (Market Voice customer quotes + competitor posts/reviews/website snapshots)
 * so recovery runs (REUSE_EVIDENCE_RECOMPUTE_ANALYSIS) can freeze a manifest
 * directly from the database without triggering paid Apify scraping.
 */
export async function hasReusableAcquiredEvidence(
  accountId: string,
  campaignId: string,
): Promise<{
  reusable: boolean;
  mvQuotesCount: number;
  postsCount: number;
  reviewsCount: number;
  webSnapshotsCount: number;
}> {
  const comps = await db
    .select({ id: ciCompetitors.id })
    .from(ciCompetitors)
    .where(and(
      eq(ciCompetitors.accountId, accountId),
      eq(ciCompetitors.campaignId, campaignId),
      eq(ciCompetitors.isActive, true)
    ));
  const compIds = comps.map((c) => c.id);

  let postsCount = 0;
  if (compIds.length > 0) {
    const posts = await db
      .select({ id: ciCompetitorPosts.id })
      .from(ciCompetitorPosts)
      .where(and(
        eq(ciCompetitorPosts.accountId, accountId),
        inArray(ciCompetitorPosts.competitorId, compIds)
      ));
    postsCount = posts.length;
  }

  const reviews = await db
    .select({ id: ciCompetitorReviews.id })
    .from(ciCompetitorReviews)
    .where(and(
      eq(ciCompetitorReviews.accountId, accountId),
      eq(ciCompetitorReviews.campaignId, campaignId)
    ));

  const mvQuotes = await db
    .select({ id: marketVoiceEvidence.id })
    .from(marketVoiceEvidence)
    .where(and(
      eq(marketVoiceEvidence.accountId, accountId),
      eq(marketVoiceEvidence.campaignId, campaignId)
    ));

  const webSnaps = await db
    .select({ id: competitorWebsiteSnapshots.id })
    .from(competitorWebsiteSnapshots)
    .where(and(
      eq(competitorWebsiteSnapshots.accountId, accountId),
      eq(competitorWebsiteSnapshots.campaignId, campaignId)
    ));

  const mvQuotesCount = mvQuotes.length;
  const reviewsCount = reviews.length;
  const webSnapshotsCount = webSnaps.length;
  const reusable = mvQuotesCount > 0 && (postsCount > 0 || reviewsCount > 0 || webSnapshotsCount > 0);

  return {
    reusable,
    mvQuotesCount,
    postsCount,
    reviewsCount,
    webSnapshotsCount,
  };
}

/**
 * Executes a coordinated parallel acquisition batch across all planned tasks
 * with bounded concurrency (cap: 3), strict dependency ordering (posts before comments),
 * lease recovery, and batch deadline controls.
 */
export async function executeAcquisitionBatch(
  canonicalContext: CanonicalAuthoritativeContext,
  options: AcquisitionBatchOptions = {}
): Promise<AcquisitionBatchSummary> {
  const startTime = Date.now();
  if (process.env.DISABLE_EXTERNAL_ACQUISITION === "1" || options.skipNetworkInTests) {
    console.log(`[AcquisitionCoordinator] EXTERNAL_ACQUISITION_DISABLED_AT_BOUNDARY | campaign=${canonicalContext.campaignId} | job=${options.orchestrationJobId || "none"} — zero network acquisition tasks planned or executed`);
    return {
      totalTasksPlanned: 0,
      completedTasks: 0,
      failedTasks: 0,
      skippedTasks: 0,
      durationMs: Date.now() - startTime,
      taskResults: {},
    };
  }
  const { accountId, campaignId } = canonicalContext;
  const cycleToken = options.orchestrationJobId || `cycle_${Date.now()}`;
  const concurrencyLimit = Math.min(options.concurrencyLimit || 3, 3);
  const deadline = startTime + (options.batchDeadlineMs || 180_000); // 3 mins default

  // 0. Ensure any interrupted/pending competitor source discovery is recovered before planning tasks
  if (!options.skipNetworkInTests && process.env.VITEST !== "true") {
    try {
      const { recoverAndRunPendingCompetitorDiscovery } = await import(
        "../competitive-intelligence/source-discovery"
      );
      await recoverAndRunPendingCompetitorDiscovery({
        accountId,
        campaignId,
        maxCompetitors: 10,
      });
    } catch (discErr: any) {
      console.warn("[Coordinator] Pre-acquisition discovery recovery warning:", discErr?.message || discErr);
    }
  }

  // 1. Plan idempotent tasks with cycleToken
  const planResult = await planAcquisitionTasks(canonicalContext, {
    forceRefresh: options.forceRefresh,
    cycleToken,
    orchestrationJobId: options.orchestrationJobId,
    requesterEngine: options.requesterEngine,
    trigger: options.trigger,
  });

  const taskResults: Record<string, { status: string; error?: string; output?: any }> = {};
  let completedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  let processedTasksInBatch = 0;
  const maxTasksCap = options.maxTasksPerBatch ?? 1000;

  // Worker loop
  async function runWorker(workerId: string): Promise<void> {
    while (Date.now() < deadline) {
      if (processedTasksInBatch >= maxTasksCap) {
        // Persist remaining PENDING tasks as DEFERRED so the next cycle resumes fairly from them
        await db
          .update(acquisitionTasks)
          .set({
            status: "DEFERRED",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(acquisitionTasks.campaignId, campaignId),
              eq(acquisitionTasks.status, "PENDING")
            )
          );
        break;
      }

      const claim = await claimNextTask(workerId, campaignId);
      if (!claim) {
        // Check if any tasks for this campaign are still RUNNING or PENDING
        const remaining = await db
          .select({ status: acquisitionTasks.status, nextRetryAt: acquisitionTasks.nextRetryAt })
          .from(acquisitionTasks)
          .where(and(
            eq(acquisitionTasks.campaignId, campaignId),
            or(eq(acquisitionTasks.status, "RUNNING"), eq(acquisitionTasks.status, "PENDING"))
          ))
          .limit(5);

        if (remaining.length === 0) {
          // No more active or pending tasks for this campaign
          break;
        }

        // If all remaining tasks are PENDING with a future nextRetryAt beyond our deadline, break early
        const allWaitingBeyondDeadline = remaining.every(
          (r) => r.status === "PENDING" && r.nextRetryAt && r.nextRetryAt.getTime() > deadline
        );
        if (allWaitingBeyondDeadline) {
          break;
        }

        // Tasks might be waiting on running dependencies, leases, or short retry backoff; sleep a tick
        await new Promise((r) => setTimeout(r, 150));
        continue;
      }

      const { task, fencingToken } = claim;
      const input = (task.inputPayload || {}) as any;

      // Dependency check: if this task depends on another task, ensure it completed
      if (input.dependsOn) {
        const [depTask] = await db
          .select({ status: acquisitionTasks.status })
          .from(acquisitionTasks)
          .where(eq(acquisitionTasks.id, input.dependsOn))
          .limit(1);

        if (depTask) {
          if (depTask.status === "PENDING" || depTask.status === "RUNNING" || depTask.status === "DEFERRED") {
            // Revert lease to PENDING so dependency can complete first
            await db
              .update(acquisitionTasks)
              .set({
                status: "PENDING",
                leaseOwner: null,
                leasedUntil: null,
                updatedAt: new Date(),
              })
              .where(and(eq(acquisitionTasks.id, task.id), eq(acquisitionTasks.fencingToken, fencingToken)));
            await new Promise((r) => setTimeout(r, 150));
            continue;
          }

          if (depTask.status === "FAILED" || depTask.status === "SKIPPED") {
            await db
              .update(acquisitionTasks)
              .set({
                status: "SKIPPED",
                outputSummary: { reason: `Dependency ${input.dependsOn} was ${depTask.status}` },
                completedAt: new Date(),
                updatedAt: new Date(),
              })
              .where(and(eq(acquisitionTasks.id, task.id), eq(acquisitionTasks.fencingToken, fencingToken)));
            skippedCount++;
            taskResults[task.id] = { status: "SKIPPED", error: `Dependency ${input.dependsOn} was ${depTask.status}` };
            continue;
          }
        }
      }

      processedTasksInBatch++;

      // Execute claimed task via canonical AcquisitionAuthority lifecycle
      const authResult = await executeClaimedAuthorityTask(claim, workerId, {
        forceRefresh: options.forceRefresh,
        orchestrationJobId: options.orchestrationJobId,
      });

      if (authResult.status === "SKIPPED") {
        skippedCount++;
        taskResults[task.id] = { status: "SKIPPED", output: authResult.output };
      } else if (authResult.status === "COMPLETED") {
        completedCount++;
        taskResults[task.id] = { status: "COMPLETED", output: authResult.output };
      } else if (authResult.status === "RETRY_SCHEDULED") {
        // Task will be re-claimed after nextRetryAt if within deadline
        taskResults[task.id] = { status: "PENDING_RETRY", error: authResult.errorMessage || undefined, output: authResult.output };
      } else {
        failedCount++;
        taskResults[task.id] = { status: "FAILED", error: authResult.errorMessage || "Acquisition task failed" };
      }
    }
  }

  // Launch bounded parallel workers (concurrency cap: 3)
  const workers = Array.from({ length: concurrencyLimit }, (_, idx) =>
    runWorker(`acq-worker-${idx + 1}-${randomUUID().slice(0, 6)}`)
  );
  await Promise.all(workers);

  return {
    totalTasksPlanned: planResult.tasksPlanned,
    completedTasks: completedCount,
    failedTasks: failedCount,
    skippedTasks: skippedCount,
    durationMs: Date.now() - startTime,
    taskResults,
  };
}
