/**
 * Unified Performance Signal Layer
 *
 * Converts scraped user channel data (user_channel_snapshots) into structured
 * content performance signals that feed the memory mutation engine as the
 * PRIMARY performance source.
 *
 * Priority model:
 *   1. channel-scrape  — scraped automatically from the user's own Instagram channel
 *   2. meta-api        — pulled from Meta Ads / Business API
 *   3. manual          — entered by the user in the UI
 *
 * This module ONLY writes to content_performance_snapshots.
 * It does NOT trigger any strategy engine or orchestrator directly.
 */

import { db } from "../db";
import { contentPerformanceSnapshots } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import type { UserChannelSnapshotData } from "../user-channel-scraper";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maps Instagram mediaType values → Avyron content format identifiers. */
const INSTAGRAM_TYPE_TO_AVYRON: Record<string, string> = {
  IMAGE: "post",
  VIDEO: "reel",
  CAROUSEL_ALBUM: "carousel",
  REEL: "reel",
  REELS: "reel",
  IGTV: "video",
};

/** Minimum posts required for a format to be considered statistically meaningful. */
const MIN_POSTS_FOR_SIGNAL = 2;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ChannelPerformanceSignal {
  contentType: string;
  rawPerformanceScore: number;
  avgEngagement: number;
  postCount: number;
  platform: string;
}

// ── Scoring ───────────────────────────────────────────────────────────────────

/**
 * Computes a normalized 0–1 performance score for a content format using its
 * engagement relative to the channel-wide average.
 *
 * Baseline (0.50) = the format performs exactly at channel average.
 * Score increases proportionally when the format outperforms the channel average.
 * Score decreases proportionally when the format underperforms.
 *
 * Formula: score = 0.5 × (formatAvg / channelAvg), clamped to [0.05, 0.95].
 *
 * Examples:
 *   formatAvg = channelAvg   → ratio = 1.0 → score = 0.50  (at baseline)
 *   formatAvg = 2× channelAvg → ratio = 2.0 → score = 0.95 (capped)
 *   formatAvg = 0.5× channelAvg → ratio = 0.5 → score = 0.25 (below baseline)
 */
function computeChannelPerformanceScore(
  formatAvgEngagement: number,
  channelAvgEngagement: number,
): number {
  if (channelAvgEngagement <= 0) return 0.5;
  const ratio = formatAvgEngagement / channelAvgEngagement;
  const raw = 0.5 * ratio;
  return Math.min(0.95, Math.max(0.05, parseFloat(raw.toFixed(4))));
}

// ── Signal extraction ─────────────────────────────────────────────────────────

/**
 * Extracts per-format performance signals from a channel snapshot.
 * Returns an empty array if the snapshot lacks engagementByType or avgEngagement.
 */
export function extractChannelSignals(
  snapshot: UserChannelSnapshotData,
): ChannelPerformanceSignal[] {
  const { engagementByType, avgEngagement: channelAvg, platform } = snapshot;

  if (!engagementByType || channelAvg == null || channelAvg <= 0) return [];

  const signals: ChannelPerformanceSignal[] = [];
  const seen = new Set<string>(); // deduplicate Avyron formats (VIDEO + REEL → both map to "reel")

  for (const [igType, { count, avgEngagement }] of Object.entries(engagementByType)) {
    const avyronFormat = INSTAGRAM_TYPE_TO_AVYRON[igType.toUpperCase()];
    if (!avyronFormat) continue;
    if (count < MIN_POSTS_FOR_SIGNAL) continue;
    if (seen.has(avyronFormat)) {
      // If we've already seen this Avyron format, pick the one with higher post count
      const existing = signals.find((s) => s.contentType === avyronFormat);
      if (existing && count > existing.postCount) {
        existing.postCount = count;
        existing.avgEngagement = avgEngagement;
        existing.rawPerformanceScore = computeChannelPerformanceScore(avgEngagement, channelAvg);
      }
      continue;
    }

    seen.add(avyronFormat);
    signals.push({
      contentType: avyronFormat,
      rawPerformanceScore: computeChannelPerformanceScore(avgEngagement, channelAvg),
      avgEngagement,
      postCount: count,
      platform,
    });
  }

  return signals;
}

// ── Smoothing ─────────────────────────────────────────────────────────────────

/**
 * Fetches the 2 most recent channel-scrape smoothed scores for a given format
 * to compute a moving average (same approach as performance-feedback/routes.ts).
 */
async function fetchPreviousChannelSmoothedScores(
  accountId: string,
  campaignId: string,
  contentType: string,
): Promise<number[]> {
  const rows = await db
    .select({ smoothedPerformanceScore: contentPerformanceSnapshots.smoothedPerformanceScore })
    .from(contentPerformanceSnapshots)
    .where(
      and(
        eq(contentPerformanceSnapshots.accountId, accountId),
        eq(contentPerformanceSnapshots.campaignId, campaignId),
        eq(contentPerformanceSnapshots.contentType, contentType),
        eq(contentPerformanceSnapshots.source, "channel-scrape"),
      ),
    )
    .orderBy(desc(contentPerformanceSnapshots.createdAt))
    .limit(2);

  return rows
    .map((r) => r.smoothedPerformanceScore)
    .filter((s): s is number => s !== null && s !== undefined);
}

/**
 * Computes a smoothed score (moving average) over the raw score and up to 2 prior
 * channel-scrape smoothed scores. Mirrors the formula in performance-feedback/scoring.ts.
 */
function computeSmoothedScore(rawScore: number, prevScores: number[]): number {
  if (prevScores.length === 0) return rawScore;
  const allScores = [rawScore, ...prevScores.slice(0, 2)];
  const sum = allScores.reduce((a, b) => a + b, 0);
  return parseFloat((sum / allScores.length).toFixed(4));
}

// ── DB ingest ─────────────────────────────────────────────────────────────────

/**
 * Converts a successfully-scraped channel snapshot into format-level performance
 * signals and writes them to content_performance_snapshots with source="channel-scrape".
 *
 * Returns the number of signal rows written.
 */
export async function ingestChannelSnapshotAsPerformanceSignals(
  campaignId: string,
  accountId: string,
  snapshot: UserChannelSnapshotData,
): Promise<number> {
  if (snapshot.scrapeStatus === "FAILED") return 0;

  const signals = extractChannelSignals(snapshot);
  if (signals.length === 0) {
    console.log(
      `[ChannelSignal] No format signals extractable for campaign=${campaignId} platform=${snapshot.platform} ` +
      `(engagementByType=${JSON.stringify(snapshot.engagementByType ?? null)} avgEngagement=${snapshot.avgEngagement})`,
    );
    return 0;
  }

  const periodLabel = `channel-scrape:${snapshot.platform}:${new Date(snapshot.scrapedAt).toISOString().slice(0, 10)}`;
  let written = 0;

  for (const signal of signals) {
    const prevSmoothed = await fetchPreviousChannelSmoothedScores(
      accountId,
      campaignId,
      signal.contentType,
    );
    const smoothedScore = computeSmoothedScore(signal.rawPerformanceScore, prevSmoothed);
    const volumePenalty = signal.postCount < 3;
    const penalizedRaw = volumePenalty ? signal.rawPerformanceScore * 0.75 : signal.rawPerformanceScore;

    const id = Date.now().toString() + Math.random().toString(36).substr(2, 9);

    await db.insert(contentPerformanceSnapshots).values({
      id,
      accountId,
      campaignId,
      contentType: signal.contentType,
      periodLabel,
      avgLikes: signal.avgEngagement,
      avgComments: 0,
      avgReach: 0,
      avgSaves: 0,
      savesRate: 0,
      avgEngagementRate: signal.rawPerformanceScore,
      reachDecayFactor: 1.0,
      totalPublished: signal.postCount,
      rawPerformanceScore: penalizedRaw,
      smoothedPerformanceScore: smoothedScore,
      volumePenaltyApplied: volumePenalty,
      source: "channel-scrape",
      notes: `Auto-ingested from ${signal.platform} channel scrape. avgEngagement=${signal.avgEngagement}, postCount=${signal.postCount}`,
    });

    console.log(
      `[ChannelSignal] Wrote signal: campaign=${campaignId} format=${signal.contentType} ` +
      `raw=${penalizedRaw.toFixed(3)} smoothed=${smoothedScore.toFixed(3)} posts=${signal.postCount} ` +
      `source=channel-scrape platform=${signal.platform}`,
    );
    written++;
  }

  return written;
}
