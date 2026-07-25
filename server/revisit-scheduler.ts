// P-1 — Per-post revisit scheduler (migration 041).
//
// WHY: publish-worker's 6h loop OVERWRITES published_posts metrics in place —
// no history survives, so the outcome tracker can never see how a post
// performed AT a point in time. This scheduler appends one immutable
// performance_snapshots row per (post, checkpoint) at 24h / 72h / 7d after
// publish. The legacy in-place loop is left untouched (dashboard readers
// depend on it); this is additive history, not a replacement.
//
// Doctrine compliance:
// - MULTI-REPLICA-SAFE: idempotency is the DB's job — a unique partial index
//   on (post_id, checkpoint) + INSERT ... ON CONFLICT DO NOTHING. No
//   select-then-insert race. The pre-check against existing checkpoints is a
//   Meta-API-cost optimization only, never the correctness mechanism.
// - NO SILENT CATCHES: every failure logs a single REVISIT_FAILED line and the
//   cycle moves on (no retry storm; the next 30-min tick retries naturally
//   because the missing (post, checkpoint) row is still due).
// - B1: metrics Meta did not return are stored as EXPLICIT nulls. Reach is
//   NEVER fabricated (the legacy loop's impressions*0.7 is not replicated).
// - B4: the RevisitTarget union is explicit about what it supports; the
//   competitor_post arm throws loudly instead of silently no-oping, so a
//   future Watchtower wire-up cannot half-work.
// - Seal #19 8-AUDIT GATE: single in-flight cycle guard + wall-clock zombie
//   eviction (steady-state 0) + _revisitSchedulerStats() introspection.

import { db } from "./db";
import { publishedPosts, performanceSnapshots } from "@shared/schema";
import { sql, and, eq, gte, isNotNull, inArray, desc } from "drizzle-orm";
import { fetchPostInsights } from "./publish-worker";

const REVISIT_TICK_MS = parseInt(process.env.REVISIT_TICK_MS || `${30 * 60 * 1000}`, 10);
const REVISIT_FIRST_TICK_DELAY_MS = 90 * 1000;
const REVISIT_WINDOW_MS = 8 * 24 * 60 * 60 * 1000;
const REVISIT_CYCLE_MAX_AGE_MS = parseInt(process.env.REVISIT_CYCLE_MAX_AGE_MS || `${30 * 60 * 1000}`, 10);
const REVISIT_BATCH_LIMIT = 200;

export type RevisitCheckpoint = "24h" | "72h" | "7d";

export const CHECKPOINT_OFFSETS_MS: Record<RevisitCheckpoint, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "72h": 72 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

const SCHEDULED_CHECKPOINTS: RevisitCheckpoint[] = ["24h", "72h", "7d"];

// Generic revisit signature so future Watchtower competitor revisits share
// this exact code path instead of growing a parallel scheduler.
export type RevisitTarget =
  | { kind: "own_post"; publishedPostId: string; checkpoint: RevisitCheckpoint }
  | { kind: "competitor_post"; competitorPostId: string; checkpoint: RevisitCheckpoint };

export type RevisitResult =
  | { ok: true; inserted: boolean }
  | { ok: false; reason: string };

export async function revisitTarget(target: RevisitTarget): Promise<RevisitResult> {
  if (target.kind === "competitor_post") {
    // B4 — explicit classification over hidden ambiguity: fail loud, not no-op.
    throw new Error(
      "REVISIT_UNSUPPORTED_TARGET: competitor_post revisits are not implemented. " +
      "This union arm exists so Watchtower can wire them here explicitly.",
    );
  }

  const rows = await db.select({
    id: publishedPosts.id,
    accountId: publishedPosts.accountId,
    metaPostId: publishedPosts.metaPostId,
    platform: publishedPosts.platform,
    mediaType: publishedPosts.mediaType,
    campaignId: publishedPosts.campaignId,
    publishedAt: publishedPosts.publishedAt,
    hookStyle: publishedPosts.hookStyle,
    contentAngle: publishedPosts.contentAngle,
  })
    .from(publishedPosts)
    .where(eq(publishedPosts.id, target.publishedPostId))
    .limit(1);

  if (rows.length === 0) return { ok: false, reason: "POST_NOT_FOUND" };
  const post = rows[0];
  if (!post.metaPostId) return { ok: false, reason: "NO_META_POST_ID" };
  if (!post.accountId) return { ok: false, reason: "NO_ACCOUNT_ID" };

  const insights = await fetchPostInsights(post.accountId, post.metaPostId);
  if (!insights.ok) return { ok: false, reason: insights.reason };

  // B1 — explicit nulls for everything Meta did not return in this call.
  // The legacy integer DEFAULT 0 columns would otherwise fabricate zeros.
  const inserted = await db.insert(performanceSnapshots).values({
    postId: post.metaPostId,
    platform: post.platform,
    checkpoint: target.checkpoint,
    contentType: post.mediaType,
    contentAngle: post.contentAngle,
    hookStyle: post.hookStyle,
    campaignId: post.campaignId,
    accountId: post.accountId,
    publishedAt: post.publishedAt,
    impressions: insights.impressions,
    engagedUsers: insights.engagement,
    clicks: insights.clicks,
    reach: null,
    likes: null,
    comments: null,
    shares: null,
    saves: null,
    watchTime: null,
    retentionRate: null,
    ctr: null,
    cpm: null,
    cpc: null,
    cpa: null,
    roas: null,
    spend: null,
    conversions: null,
  })
    .onConflictDoNothing()
    .returning({ id: performanceSnapshots.id });

  return { ok: true, inserted: inserted.length > 0 };
}

async function runRevisitCycle(): Promise<void> {
  const now = Date.now();
  const windowStart = new Date(now - REVISIT_WINDOW_MS);

  const candidates = await db.select({
    id: publishedPosts.id,
    metaPostId: publishedPosts.metaPostId,
    publishedAt: publishedPosts.publishedAt,
  })
    .from(publishedPosts)
    .where(and(
      eq(publishedPosts.status, "published"),
      isNotNull(publishedPosts.metaPostId),
      isNotNull(publishedPosts.publishedAt),
      gte(publishedPosts.publishedAt, windowStart),
    ))
    // Newest first so fully-captured old posts cannot starve fresh posts out
    // of the batch when >REVISIT_BATCH_LIMIT posts sit inside the 8d window.
    .orderBy(desc(publishedPosts.publishedAt))
    .limit(REVISIT_BATCH_LIMIT);

  if (candidates.length > 0) {
    // Cost optimization only — correctness lives in the unique partial index.
    const metaIds = candidates.map(c => c.metaPostId).filter((id): id is string => !!id);
    const existing = await db.select({
      postId: performanceSnapshots.postId,
      checkpoint: performanceSnapshots.checkpoint,
    })
      .from(performanceSnapshots)
      .where(and(
        inArray(performanceSnapshots.postId, metaIds),
        inArray(performanceSnapshots.checkpoint, SCHEDULED_CHECKPOINTS),
      ));
    const captured = new Set(existing.map(e => `${e.postId}|${e.checkpoint}`));

    let dueCount = 0;
    let capturedCount = 0;
    let failedCount = 0;

    for (const candidate of candidates) {
      if (isShuttingDown) break;
      if (!candidate.publishedAt || !candidate.metaPostId) continue;
      const publishedAtMs = candidate.publishedAt.getTime();

      for (const checkpoint of SCHEDULED_CHECKPOINTS) {
        if (isShuttingDown) break;
        if (publishedAtMs + CHECKPOINT_OFFSETS_MS[checkpoint] > now) continue;
        if (captured.has(`${candidate.metaPostId}|${checkpoint}`)) continue;

        dueCount++;
        try {
          const result = await revisitTarget({
            kind: "own_post",
            publishedPostId: candidate.id,
            checkpoint,
          });
          if (!result.ok) {
            failedCount++;
            console.warn(
              `[RevisitScheduler] REVISIT_FAILED | post=${candidate.id} checkpoint=${checkpoint} reason="${result.reason}" — will retry next tick.`,
            );
          } else if (result.inserted) {
            capturedCount++;
            console.log(
              `[RevisitScheduler] REVISIT_CAPTURED | post=${candidate.id} metaPost=${candidate.metaPostId} checkpoint=${checkpoint}`,
            );
          } else {
            // ON CONFLICT DO NOTHING — another replica captured it first. Expected under multi-replica.
            console.log(
              `[RevisitScheduler] REVISIT_DUPLICATE | post=${candidate.id} checkpoint=${checkpoint} — snapshot already exists (peer replica).`,
            );
          }
        } catch (err: any) {
          failedCount++;
          console.warn(
            `[RevisitScheduler] REVISIT_FAILED | post=${candidate.id} checkpoint=${checkpoint} err="${err?.message ?? String(err)}" — will retry next tick.`,
          );
        }
      }
    }

    if (dueCount > 0) {
      console.log(
        `[RevisitScheduler] CYCLE_SUMMARY | candidates=${candidates.length} due=${dueCount} captured=${capturedCount} failed=${failedCount}`,
      );
    }
  }

  // Orphan sweep — checkpoint snapshots whose post_id matches no published
  // post are structurally invisible to the outcome tracker. Steady-state 0.
  const orphanResult = await db.execute(sql`
    SELECT count(*)::int AS cnt
    FROM performance_snapshots ps
    WHERE ps.checkpoint IN ('24h', '72h', '7d')
      AND NOT EXISTS (
        SELECT 1 FROM published_posts pp WHERE pp.meta_post_id = ps.post_id
      )
  `);
  const orphanCount = Number((orphanResult.rows?.[0] as { cnt?: number } | undefined)?.cnt) || 0;
  if (orphanCount > 0) {
    console.warn(
      `[RevisitScheduler] OUTCOME_SNAPSHOT_ORPHAN | count=${orphanCount} — checkpoint snapshots whose post_id matches no published_posts.meta_post_id. Steady-state expectation is 0.`,
    );
  }
}

let revisitTimer: ReturnType<typeof setInterval> | null = null;
let firstTickTimer: ReturnType<typeof setTimeout> | null = null;
let isShuttingDown = false;
let cycleInFlight = false;
let cycleStartedAt = 0;
let cycleGeneration = 0;
let zombieEvictions = 0;
let cyclesCompleted = 0;
let cyclesFailed = 0;
let lastCycleCompletedAt: Date | null = null;

async function tick(): Promise<void> {
  if (isShuttingDown) return;
  if (cycleInFlight) {
    const ageMs = Date.now() - cycleStartedAt;
    if (ageMs < REVISIT_CYCLE_MAX_AGE_MS) {
      console.warn(`[RevisitScheduler] TICK_SKIPPED_INFLIGHT | prior cycle still running (age=${Math.round(ageMs / 1000)}s).`);
      return;
    }
    // Wall-clock watchdog — a cycle pinned past the ceiling is presumed dead.
    zombieEvictions++;
    console.error(
      `[RevisitScheduler] ZOMBIE_CYCLE_EVICTED | prior cycle exceeded ${REVISIT_CYCLE_MAX_AGE_MS}ms (age=${ageMs}ms). ` +
      `Steady-state expectation for zombieEvictions is 0.`,
    );
  }
  cycleInFlight = true;
  cycleStartedAt = Date.now();
  // Generation counter: if THIS cycle is later evicted as a zombie and its
  // replacement starts, the zombie's finally block must not clear the
  // replacement's in-flight flag.
  const myGeneration = ++cycleGeneration;
  try {
    await runRevisitCycle();
    cyclesCompleted++;
    lastCycleCompletedAt = new Date();
  } catch (err: any) {
    cyclesFailed++;
    console.error(`[RevisitScheduler] CYCLE_FAILED | err="${err?.message ?? String(err)}"`);
  } finally {
    if (myGeneration === cycleGeneration) {
      cycleInFlight = false;
    }
  }
}

export function startRevisitScheduler(): void {
  if (process.env.REVISIT_SCHEDULER_DISABLED === "true" || process.env.REVISIT_SCHEDULER_DISABLED === "1") {
    console.log("[RevisitScheduler] DISABLED via REVISIT_SCHEDULER_DISABLED — no revisit snapshots will be captured.");
    return;
  }
  if (revisitTimer) return;
  isShuttingDown = false;
  firstTickTimer = setTimeout(() => { void tick(); }, REVISIT_FIRST_TICK_DELAY_MS);
  revisitTimer = setInterval(() => { void tick(); }, REVISIT_TICK_MS);
  console.log(`[RevisitScheduler] STARTED | tick=${REVISIT_TICK_MS}ms checkpoints=${SCHEDULED_CHECKPOINTS.join(",")} window=8d`);
}

export async function stopRevisitScheduler(): Promise<void> {
  isShuttingDown = true;
  if (firstTickTimer) {
    clearTimeout(firstTickTimer);
    firstTickTimer = null;
  }
  if (revisitTimer) {
    clearInterval(revisitTimer);
    revisitTimer = null;
  }
  // Drain: wait briefly for an in-flight cycle to observe isShuttingDown.
  const drainDeadline = Date.now() + 10_000;
  while (cycleInFlight && Date.now() < drainDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (cycleInFlight) {
    console.warn("[RevisitScheduler] SHUTDOWN_WITH_CYCLE_INFLIGHT | cycle did not drain within 10s.");
  }
  console.log("[RevisitScheduler] STOPPED");
}

/** Introspection hook (Seal #19 8-audit gate). Steady-state zombieEvictions = 0. */
export function _revisitSchedulerStats() {
  return {
    running: revisitTimer !== null,
    cycleInFlight,
    zombieEvictions,
    cyclesCompleted,
    cyclesFailed,
    lastCycleCompletedAt,
  };
}

/**
 * Chain-registry introspector (Seal #14 CHAIN-STATE-EXPLICIT). A cycle
 * completes every tick even when zero targets are due, so this is a truthful
 * per-replica cadence signal. Returns null until the first successful cycle
 * (or forever when REVISIT_SCHEDULER_DISABLED) — the chain then classifies
 * UNKNOWN/DEAD instead of silently HEALTHY, which is the honest signal.
 */
export function _lastRevisitCycleCompletedAt(): Date | null {
  return lastCycleCompletedAt;
}
