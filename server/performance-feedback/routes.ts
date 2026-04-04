import type { Express } from "express";
import { db } from "../db";
import { contentPerformanceSnapshots } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import {
  computeRawScore,
  applyVolumePenalty,
  computeSmoothedScore,
  computeStabilitySignal,
} from "./scoring";
import { runMemoryMutation } from "../memory-mutation/engine";

const CONTENT_TYPES = ["reel", "carousel", "story", "post"] as const;
const VALID_SOURCES = ["manual", "meta-api"] as const;
type ContentType = typeof CONTENT_TYPES[number];

function clampRate(val: number): number {
  return Math.max(0, Math.min(1, val));
}

export function registerPerformanceFeedbackRoutes(app: Express) {
  app.post("/api/performance/ingest", async (req: any, res) => {
    const accountId = req.user?.accountId || req.accountId || "default";
    const {
      campaignId,
      contentType,
      periodLabel,
      periodStart,
      periodEnd,
      avgReach,
      avgSaves,
      savesRate,
      avgEngagementRate,
      avgLikes,
      avgComments,
      reachDecayFactor,
      totalPublished,
      source,
      notes,
    } = req.body;

    if (!campaignId || !contentType || !periodLabel) {
      return res.status(400).json({ error: "campaignId, contentType, and periodLabel are required" });
    }
    if (!CONTENT_TYPES.includes(contentType as ContentType)) {
      return res.status(400).json({ error: `contentType must be one of: ${CONTENT_TYPES.join(", ")}` });
    }
    if (source && !VALID_SOURCES.includes(source)) {
      return res.status(400).json({ error: `source must be one of: ${VALID_SOURCES.join(", ")}` });
    }

    const toNum = (v: any, def = 0): number => {
      const n = typeof v === "number" ? v : parseFloat(v);
      return isNaN(n) ? def : n;
    };
    const toNonNeg = (v: any, def = 0) => Math.max(0, toNum(v, def));

    const parsedSavesRate = clampRate(toNum(savesRate));
    const parsedEngagementRate = clampRate(toNum(avgEngagementRate));
    const parsedDecay = Math.max(0, Math.min(2, toNum(reachDecayFactor, 1.0)));
    const parsedPublished = Math.round(toNonNeg(totalPublished));

    const rawInput = {
      savesRate: parsedSavesRate,
      avgEngagementRate: parsedEngagementRate,
      reachDecayFactor: parsedDecay,
      totalPublished: parsedPublished,
    };

    const rawScore = computeRawScore(rawInput);
    const { score: rawWithPenalty, penaltyApplied } = applyVolumePenalty(rawScore, rawInput.totalPublished);

    const previousSnaps = await db
      .select({ smoothedPerformanceScore: contentPerformanceSnapshots.smoothedPerformanceScore })
      .from(contentPerformanceSnapshots)
      .where(
        and(
          eq(contentPerformanceSnapshots.accountId, accountId),
          eq(contentPerformanceSnapshots.campaignId, campaignId),
          eq(contentPerformanceSnapshots.contentType, contentType)
        )
      )
      .orderBy(desc(contentPerformanceSnapshots.createdAt))
      .limit(2);

    const prevScores = previousSnaps
      .map((s) => s.smoothedPerformanceScore)
      .filter((s): s is number => s !== null && s !== undefined);

    const smoothedScore = computeSmoothedScore(rawWithPenalty, prevScores);

    const id = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    await db.insert(contentPerformanceSnapshots).values({
      id,
      accountId,
      campaignId,
      contentType,
      periodLabel,
      periodStart: periodStart ? new Date(periodStart) : null,
      periodEnd: periodEnd ? new Date(periodEnd) : null,
      avgReach: toNonNeg(avgReach),
      avgSaves: toNonNeg(avgSaves),
      savesRate: parsedSavesRate,
      avgEngagementRate: parsedEngagementRate,
      avgLikes: toNonNeg(avgLikes),
      avgComments: toNonNeg(avgComments),
      reachDecayFactor: parsedDecay,
      totalPublished: parsedPublished,
      rawPerformanceScore: rawWithPenalty,
      smoothedPerformanceScore: smoothedScore,
      volumePenaltyApplied: penaltyApplied,
      source: source || "manual",
      notes: notes || null,
    });

    runMemoryMutation(accountId, campaignId).catch((err: Error) => {
      console.warn(`[PerformanceFeedback] Memory mutation fire-and-forget failed:`, err.message);
    });

    return res.json({
      success: true,
      id,
      rawPerformanceScore: rawWithPenalty,
      smoothedPerformanceScore: smoothedScore,
      volumePenaltyApplied: penaltyApplied,
    });
  });

  app.post("/api/memory/mutate", async (req: any, res) => {
    const accountId = req.user?.accountId || req.accountId || "default";
    const { campaignId } = req.body;
    if (!campaignId) {
      return res.status(400).json({ error: "campaignId is required" });
    }
    try {
      const result = await runMemoryMutation(accountId, campaignId);
      return res.json({ success: true, ...result });
    } catch (err: any) {
      console.error(`[MemoryMutate] Manual trigger failed:`, err.message);
      return res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/performance/summary/:campaignId", async (req: any, res) => {
    const accountId = req.user?.accountId || req.accountId || "default";
    const { campaignId } = req.params;

    const summaryByFormat: Record<string, any> = {};

    for (const ct of CONTENT_TYPES) {
      const snaps = await db
        .select()
        .from(contentPerformanceSnapshots)
        .where(
          and(
            eq(contentPerformanceSnapshots.accountId, accountId),
            eq(contentPerformanceSnapshots.campaignId, campaignId),
            eq(contentPerformanceSnapshots.contentType, ct)
          )
        )
        .orderBy(desc(contentPerformanceSnapshots.createdAt))
        .limit(4);

      if (snaps.length === 0) {
        summaryByFormat[ct] = null;
        continue;
      }

      const scores = snaps.map((s) => s.smoothedPerformanceScore ?? 0);
      const latest = snaps[0];

      let recencyWeighted: number;
      if (snaps.length === 1) {
        recencyWeighted = scores[0];
      } else if (snaps.length === 2) {
        recencyWeighted = (scores[0] * 3 + scores[1] * 1.5) / 4.5;
      } else {
        const olderSum = scores.slice(2).reduce((a, b) => a + b, 0);
        recencyWeighted = (scores[0] * 3 + scores[1] * 1.5 + olderSum) / (3 + 1.5 + Math.max(0, snaps.length - 2));
      }

      const stabilitySignal = computeStabilitySignal(scores);

      summaryByFormat[ct] = {
        contentType: ct,
        latestSmoothedScore: latest.smoothedPerformanceScore,
        recencyWeightedScore: recencyWeighted,
        stabilitySignal,
        totalPeriods: snaps.length,
        lastUpdated: latest.createdAt,
        latestPeriodLabel: latest.periodLabel,
        avgEngagementRate: latest.avgEngagementRate,
        savesRate: latest.savesRate,
        avgReach: latest.avgReach,
        totalPublished: latest.totalPublished,
        volumePenaltyApplied: latest.volumePenaltyApplied,
      };
    }

    const formatEntries = Object.entries(summaryByFormat)
      .filter(([, v]) => v !== null)
      .sort(([, a], [, b]) => (b.recencyWeightedScore ?? 0) - (a.recencyWeightedScore ?? 0));

    const dominantFormat = formatEntries[0]?.[0] || null;
    const allScores = formatEntries.map(([, v]) => v.recencyWeightedScore ?? 0);
    const avgScore = allScores.length > 0 ? allScores.reduce((a, b) => a + b, 0) / allScores.length : 0;
    const underperformingFormats = formatEntries
      .filter(([, v]) => (v.recencyWeightedScore ?? 0) < avgScore * 0.8)
      .map(([k]) => k);

    return res.json({
      campaignId,
      summaryByFormat,
      dominantFormat,
      underperformingFormats,
      totalFormatsTracked: formatEntries.length,
    });
  });
}
