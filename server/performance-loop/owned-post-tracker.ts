/**
 * P-2 Phase 2B — Owned-post persistence + append-only checkpoint snapshots.
 *
 * ARCHITECTURE INVARIANT (inherited from user-channel-scraper):
 * This module ONLY writes to the database (owned_posts, owned_post_snapshots).
 * It NEVER triggers any strategy engine, orchestrator, or worker.
 *
 * Target classification: everything in this module is target=owned_account.
 * Competitor posts continue to flow through ci_competitor_posts untouched.
 *
 * NULL-never-zero: metric values are persisted exactly as scraped. A metric
 * the public surface did not expose stays NULL — it is never coerced to 0.
 */

import { db } from "../db";
import {
  ownedPosts,
  ownedPostSnapshots,
  type OwnedSnapshotCheckpoint,
} from "@shared/schema";
import { and, eq, inArray, desc } from "drizzle-orm";
import type { ScrapedPost } from "../competitive-intelligence/profile-scraper";

/**
 * Checkpoint band edges (hours). The band label is a coarse classification;
 * the ACTUAL observation age is always stored alongside it. A post discovered
 * after a band passed is labeled 'late' — never back-filled into a nominal
 * checkpoint it was not observed at (prompt Phase 2B).
 */
const BAND_24H_START = 12;
const BAND_72H_START = 48;
const BAND_7D_START = 132;
const BAND_LATE_START = 240;

/** Minimum spacing between non-banded (discovery/late/unknown_age) rows per post. */
const NON_BANDED_DEDUPE_MS = 6 * 60 * 60 * 1000; // 6h

export function classifyObservation(
  postedAt: Date | null,
  observedAt: Date,
): { checkpoint: OwnedSnapshotCheckpoint; ageHours: number | null } {
  if (!postedAt || Number.isNaN(postedAt.getTime())) {
    return { checkpoint: "unknown_age", ageHours: null };
  }
  const ageHours = (observedAt.getTime() - postedAt.getTime()) / 3_600_000;
  if (ageHours < BAND_24H_START) return { checkpoint: "discovery", ageHours };
  if (ageHours < BAND_72H_START) return { checkpoint: "24h", ageHours };
  if (ageHours < BAND_7D_START) return { checkpoint: "72h", ageHours };
  if (ageHours < BAND_LATE_START) return { checkpoint: "7d", ageHours };
  return { checkpoint: "late", ageHours };
}

export interface OwnedPostObservationInput {
  accountId: string;
  campaignId: string;
  ownedProfileId: string;
  platform: string;
  posts: ScrapedPost[];
  followers: number | null;
  /** user_channel_snapshots row id of this scrape run (provenance link). */
  scrapeSnapshotId: string | null;
}

export interface OwnedPostObservationResult {
  postsSeen: number;
  postsCreated: number;
  postsUpdated: number;
  snapshotsInserted: number;
  snapshotsSkippedDuplicate: number;
  persistFailures: number;
  /** owned_posts.id values touched in this run (for lineage resolution). */
  ownedPostIds: string[];
  newOwnedPostIds: string[];
}

function parsePostTimestamp(raw: string | null): Date | null {
  if (!raw) return null;
  // Scraper timestamps are unix seconds (taken_at_timestamp) serialized as
  // string, or ISO strings depending on path. Handle both explicitly.
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    const d = new Date(n < 1e12 ? n * 1000 : n);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Persist per-post records and one append-only observation row per post.
 * Idempotent: banded checkpoints (24h/72h/7d) are protected by the DB unique
 * index (ON CONFLICT DO NOTHING); non-banded rows are deduped by a 6h spacing
 * guard so repeated manual runs do not flood history.
 */
export async function recordOwnedPostObservations(
  input: OwnedPostObservationInput,
): Promise<OwnedPostObservationResult> {
  const observedAt = new Date();
  const result: OwnedPostObservationResult = {
    postsSeen: input.posts.length,
    postsCreated: 0,
    postsUpdated: 0,
    snapshotsInserted: 0,
    snapshotsSkippedDuplicate: 0,
    persistFailures: 0,
    ownedPostIds: [],
    newOwnedPostIds: [],
  };
  if (input.posts.length === 0) return result;

  // Existing posts for this profile (bounded: <= max scrape size per run).
  const scrapedIds = input.posts.map((p) => p.postId).filter(Boolean);
  const existing = scrapedIds.length
    ? await db
        .select({ id: ownedPosts.id, postId: ownedPosts.postId })
        .from(ownedPosts)
        .where(
          and(
            eq(ownedPosts.ownedProfileId, input.ownedProfileId),
            inArray(ownedPosts.postId, scrapedIds),
          ),
        )
    : [];
  const existingByPostId = new Map(existing.map((r) => [r.postId, r.id]));

  for (const post of input.posts) {
    if (!post.postId) {
      result.persistFailures++;
      console.error(
        `[OwnedPostTracker] OWNED_POST_PERSIST_FAILED reason=missing_post_id profile=${input.ownedProfileId} shortcode=${post.shortcode || "unknown"}`,
      );
      continue;
    }
    try {
      const postedAt = parsePostTimestamp(post.timestamp);
      let ownedPostId = existingByPostId.get(post.postId);

      if (ownedPostId) {
        await db
          .update(ownedPosts)
          .set({
            lastSeenAt: observedAt,
            permalink: post.permalink || undefined,
            shortcode: post.shortcode || undefined,
            mediaType: post.mediaType || undefined,
            caption: post.caption ?? undefined,
            postedAt: postedAt ?? undefined,
            updatedAt: observedAt,
          })
          .where(eq(ownedPosts.id, ownedPostId));
        result.postsUpdated++;
      } else {
        const inserted = await db
          .insert(ownedPosts)
          .values({
            accountId: input.accountId,
            campaignId: input.campaignId,
            ownedProfileId: input.ownedProfileId,
            platform: input.platform,
            postId: post.postId,
            shortcode: post.shortcode || null,
            permalink: post.permalink || null,
            mediaType: post.mediaType || null,
            caption: post.caption,
            postedAt,
            firstSeenAt: observedAt,
            lastSeenAt: observedAt,
            // lineage_state starts 'unmatched'; the lineage resolver is the
            // sole writer of lineage fields (D2 single-writer discipline).
          })
          .onConflictDoNothing({
            target: [ownedPosts.ownedProfileId, ownedPosts.postId],
          })
          .returning({ id: ownedPosts.id });
        if (inserted.length > 0) {
          ownedPostId = inserted[0].id;
          result.postsCreated++;
          result.newOwnedPostIds.push(ownedPostId);
        } else {
          // Concurrent writer won the race — fetch the surviving row.
          const row = await db
            .select({ id: ownedPosts.id })
            .from(ownedPosts)
            .where(
              and(
                eq(ownedPosts.ownedProfileId, input.ownedProfileId),
                eq(ownedPosts.postId, post.postId),
              ),
            )
            .limit(1);
          if (row.length === 0) throw new Error("insert conflict but row not found");
          ownedPostId = row[0].id;
          result.postsUpdated++;
        }
      }
      result.ownedPostIds.push(ownedPostId);

      // ── Observation snapshot (append-only) ────────────────────────────
      const { checkpoint, ageHours } = classifyObservation(postedAt, observedAt);

      if (checkpoint === "discovery" || checkpoint === "late" || checkpoint === "unknown_age") {
        // Non-banded: dedupe by spacing so tight re-runs don't flood history.
        const last = await db
          .select({ observedAt: ownedPostSnapshots.observedAt })
          .from(ownedPostSnapshots)
          .where(
            and(
              eq(ownedPostSnapshots.ownedPostId, ownedPostId),
              eq(ownedPostSnapshots.checkpoint, checkpoint),
              eq(ownedPostSnapshots.metricSource, "public_scrape"),
            ),
          )
          .orderBy(desc(ownedPostSnapshots.observedAt))
          .limit(1);
        if (
          last.length > 0 &&
          observedAt.getTime() - last[0].observedAt.getTime() < NON_BANDED_DEDUPE_MS
        ) {
          result.snapshotsSkippedDuplicate++;
          continue;
        }
      }

      const insertedSnap = await db
        .insert(ownedPostSnapshots)
        .values({
          accountId: input.accountId,
          campaignId: input.campaignId,
          ownedPostId,
          checkpoint,
          observedAt,
          observationAgeHours: ageHours,
          // NULL stays NULL — never coerce a missing public metric to 0.
          likes: post.likes,
          comments: post.comments,
          views: post.views,
          followersAtObservation: input.followers,
          metricSource: "public_scrape",
          scrapeSnapshotId: input.scrapeSnapshotId,
        })
        .onConflictDoNothing()
        .returning({ id: ownedPostSnapshots.id });

      if (insertedSnap.length > 0) {
        result.snapshotsInserted++;
      } else {
        result.snapshotsSkippedDuplicate++;
      }
    } catch (err: any) {
      result.persistFailures++;
      console.error(
        `[OwnedPostTracker] OWNED_POST_PERSIST_FAILED postId=${post.postId} profile=${input.ownedProfileId} err=${err?.message ?? String(err)}`,
      );
    }
  }

  console.log(
    `[OwnedPostTracker] target=owned_account profile=${input.ownedProfileId} seen=${result.postsSeen} created=${result.postsCreated} updated=${result.postsUpdated} snapshots=${result.snapshotsInserted} dupSkipped=${result.snapshotsSkippedDuplicate} failures=${result.persistFailures}`,
  );
  return result;
}
