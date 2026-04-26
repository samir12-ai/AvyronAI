/**
 * Phase 5 — Rhythm compliance evaluation.
 *
 * Locked by Samir 2026-04-20:
 *   - Read planned rhythm from strategic_plans.approved_rhythm_json ONLY.
 *     `required_work` is mutable by the adaptive-rhythm engine and would drift.
 *   - Count actual posts from published_posts WHERE status='published' ONLY.
 *     studio_items excluded (conservative count avoids false-positive compliance).
 *   - Thresholds: compliant >= 100% of plan, partial >= 50% < 100%, non_compliant < 50%.
 *   - Per-channel aggregation: worst-channel-wins (one non-compliant channel
 *     non-compliants the whole window).
 *   - All-zero plan -> compliant with reason "no_rhythm_planned".
 *
 * Pure: read-only over strategic_plans + published_posts. No DB writes.
 */
import { db } from "../../../db";
import { publishedPosts } from "@shared/schema";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { RhythmConfigSchema, type RhythmConfig } from "@shared/contracts";
import { recordRejection } from "../../rejection-log";

const WINDOW_DAYS = 7;
const COMPLIANT_THRESHOLD = 1.0;  // >= 100%
const PARTIAL_THRESHOLD = 0.5;    // >= 50%

export type RhythmStatus = "compliant" | "partial" | "non_compliant";

export interface RhythmChannelResult {
  channel: string;
  planned: number;
  actual: number;
  ratio: number;
  status: RhythmStatus;
}

export interface RhythmComplianceResult {
  status: RhythmStatus | "no_active_plan" | "rhythm_invalid";
  plannedTotal: number;
  actualTotal: number;
  perChannel: RhythmChannelResult[];
  /**
   * "no_rhythm_planned" if plan specifies all-zero cadence.
   * "rhythm_invalid" + reason "rhythm_config_invalid" if the persisted blob
   * cannot be parsed as a canonical RhythmConfig (Phase 6.5 hard-reject).
   */
  reason?: string;
}

/**
 * Phase 6.5 — Integrity Engineering (Samir, locked 2026-04-20):
 *   Strict parse via RhythmConfigSchema. No camelCase fallback. No silent {}.
 *   Returns null on any malformed input — caller surfaces "rhythm_invalid".
 *   Operators must rebake the plan to repair (no auto-migration).
 */
interface ParseRhythmResult {
  rhythm: RhythmConfig | null;
  reasonCode: "RHYTHM_JSON_UNPARSEABLE" | "RHYTHM_SHAPE_INVALID" | null;
  detail: string | null;
}

function parseApprovedRhythm(raw: string | null): ParseRhythmResult {
  if (!raw) return { rhythm: null, reasonCode: null, detail: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      rhythm: null,
      reasonCode: "RHYTHM_JSON_UNPARSEABLE",
      detail: (err as Error).message,
    };
  }
  const result = RhythmConfigSchema.safeParse(parsed);
  if (!result.success) {
    return {
      rhythm: null,
      reasonCode: "RHYTHM_SHAPE_INVALID",
      detail: JSON.stringify(result.error.issues),
    };
  }
  return { rhythm: result.data, reasonCode: null, detail: null };
}

function classify(planned: number, actual: number): RhythmStatus {
  if (planned <= 0) return "compliant";
  const ratio = actual / planned;
  if (ratio >= COMPLIANT_THRESHOLD) return "compliant";
  if (ratio >= PARTIAL_THRESHOLD) return "partial";
  return "non_compliant";
}

function worstWins(results: RhythmChannelResult[]): RhythmStatus {
  if (results.length === 0) return "compliant";
  if (results.some((r) => r.status === "non_compliant")) return "non_compliant";
  if (results.some((r) => r.status === "partial")) return "partial";
  return "compliant";
}

/**
 * Bucket published posts by content "channel" using a coarse heuristic.
 * Phase 5 keeps this simple — published_posts.platform alone is too coarse
 * (posts/reels/carousels can all live on Instagram), so for MVP we treat
 * everything as the generic "posts" bucket and compare against posts_per_week.
 *
 * If the approved rhythm specifies channel-specific counters and we want
 * per-channel breakdown later, we'd extend this with media_type detection
 * (e.g., from publishedPosts.mediaType which already exists).
 *
 * For Phase 5 we DO break out reels/carousels/videos/stories using mediaType
 * where present, falling back to "posts" for the remainder. This honors the
 * "per-channel breakdown is operator-visible" intent without inventing
 * classification signals that don't exist in the data.
 */
interface ActualBuckets {
  posts: number;
  reels: number;
  carousels: number;
  videos: number;
  stories: number;
}

function bucketActual(rows: Array<{ mediaType: string | null }>): ActualBuckets {
  const b: ActualBuckets = { posts: 0, reels: 0, carousels: 0, videos: 0, stories: 0 };
  for (const r of rows) {
    const t = (r.mediaType ?? "image").toLowerCase();
    if (t.includes("reel")) b.reels++;
    else if (t.includes("carousel") || t.includes("album")) b.carousels++;
    else if (t.includes("video")) b.videos++;
    else if (t.includes("story") || t.includes("stories")) b.stories++;
    else b.posts++;
  }
  return b;
}

export interface EvaluateRhythmInput {
  campaignId: string;
  windowStart: Date;
  windowEnd: Date;
  approvedRhythmJson: string | null;
}

export async function evaluateRhythmCompliance(
  input: EvaluateRhythmInput,
): Promise<RhythmComplianceResult> {
  // Phase 6.5 — hard-reject malformed/legacy rhythm blobs. Caller surfaces this
  // as a structural integrity failure; rhythm-compliance does not silently
  // count "0 planned" against a plan whose persisted shape cannot be trusted.
  if (input.approvedRhythmJson == null) {
    return {
      status: "no_active_plan",
      plannedTotal: 0,
      actualTotal: 0,
      perChannel: [],
      reason: "no_approved_rhythm",
    };
  }
  const parseResult = parseApprovedRhythm(input.approvedRhythmJson);
  if (!parseResult.rhythm) {
    // Phase 6.5 — record an integrity rejection so the admin dashboard can
    // surface that this campaign's rhythm config is structurally broken.
    await recordRejection({
      boundary: "reader",
      tableName: "strategic_plans.approved_rhythm_json",
      campaignId: input.campaignId,
      reasonCode: parseResult.reasonCode ?? "RHYTHM_SHAPE_INVALID",
      reasonDetail: parseResult.detail ?? "approved_rhythm_json failed canonical RhythmConfig parse",
      context: { rawSample: input.approvedRhythmJson.slice(0, 200) },
    });
    return {
      status: "rhythm_invalid",
      plannedTotal: 0,
      actualTotal: 0,
      perChannel: [],
      reason: "rhythm_config_invalid",
    };
  }
  const rhythm = parseResult.rhythm;

  // Planned counts for the 7-day window.
  const plannedPosts = rhythm.posts_per_week;
  const plannedReels = rhythm.reels_per_week;
  const plannedCarousels = rhythm.carousels_per_week;
  const plannedVideos = rhythm.videos_per_week;
  const plannedStories = rhythm.stories_per_day * WINDOW_DAYS;

  const plannedByChannel: Record<keyof ActualBuckets, number> = {
    posts: plannedPosts,
    reels: plannedReels,
    carousels: plannedCarousels,
    videos: plannedVideos,
    stories: plannedStories,
  };

  const plannedTotal =
    plannedPosts + plannedReels + plannedCarousels + plannedVideos + plannedStories;

  // All-zero plan -> compliant by default, excluded from hierarchy.
  if (plannedTotal === 0) {
    return {
      status: "compliant",
      plannedTotal: 0,
      actualTotal: 0,
      perChannel: [],
      reason: "no_rhythm_planned",
    };
  }

  // Actual published posts in the window for this campaign.
  const rows = await db
    .select({ mediaType: publishedPosts.mediaType })
    .from(publishedPosts)
    .where(
      and(
        eq(publishedPosts.campaignId, input.campaignId),
        eq(publishedPosts.status, "published"),
        gte(publishedPosts.publishedAt, input.windowStart),
        lt(publishedPosts.publishedAt, input.windowEnd),
      ),
    );

  const actual = bucketActual(rows);
  const actualTotal = actual.posts + actual.reels + actual.carousels + actual.videos + actual.stories;

  // Per-channel: only include channels with planned > 0 (we don't penalize for
  // posting types that weren't in the plan).
  const perChannel: RhythmChannelResult[] = [];
  (Object.keys(plannedByChannel) as Array<keyof ActualBuckets>).forEach((ch) => {
    const planned = plannedByChannel[ch];
    if (planned <= 0) return;
    const act = actual[ch];
    perChannel.push({
      channel: ch,
      planned,
      actual: act,
      ratio: planned > 0 ? act / planned : 1,
      status: classify(planned, act),
    });
  });

  return {
    status: worstWins(perChannel),
    plannedTotal,
    actualTotal,
    perChannel,
  };
}
