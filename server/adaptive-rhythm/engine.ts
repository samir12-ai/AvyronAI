import { db } from "../db";
import {
  contentPerformanceSnapshots,
  strategyMemory,
  miSnapshots,
  businessDataLayer,
} from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { loadMemoryBlock } from "../memory-system/manager";
import { computeExplorationBudget } from "../exploration-budget/engine";

export interface AdaptiveRhythm {
  reelsPerWeek: number;
  carouselsPerWeek: number;
  storiesPerDay: number;
  postsPerWeek: number;
  reasoning: string;
  confidenceScore: number;
  performanceBasis: "performance_data" | "competitor_benchmark" | "default_balanced";
  deltaFromPrevious: {
    reels: number;
    carousels: number;
    stories: number;
    posts: number;
  };
}

const FORMAT_KEYS = ["reel", "carousel", "story", "post"] as const;
type FormatKey = typeof FORMAT_KEYS[number];

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function parseBudgetToMonthly(budgetStr: string): number {
  const n = parseFloat(budgetStr.toString().replace(/[^0-9.]/g, ""));
  return isNaN(n) ? 1000 : n;
}

function weeklySlotBudget(monthlyBudget: number): number {
  if (monthlyBudget < 500) return 7;
  if (monthlyBudget < 1500) return 9;
  if (monthlyBudget < 5000) return 11;
  return 12;
}

function extractCompetitorVelocity(miData: any): Record<FormatKey, number> {
  const defaults: Record<FormatKey, number> = { reel: 0.40, carousel: 0.25, story: 0.25, post: 0.10 };
  if (!miData) return defaults;
  try {
    const competitors = Array.isArray(miData.competitorData) ? miData.competitorData : [];
    const formatCounts: Record<FormatKey, number> = { reel: 0, carousel: 0, story: 0, post: 0 };
    let totalSeen = 0;

    for (const comp of competitors) {
      const formats: any[] = comp.contentFormats || comp.formats || comp.postTypes || [];
      for (const fmt of formats) {
        const fmtStr = (typeof fmt === "string" ? fmt : fmt.type || "").toLowerCase();
        if (fmtStr.includes("reel") || fmtStr.includes("video")) {
          formatCounts.reel++;
          totalSeen++;
        } else if (fmtStr.includes("carousel") || fmtStr.includes("album")) {
          formatCounts.carousel++;
          totalSeen++;
        } else if (fmtStr.includes("story") || fmtStr.includes("stories")) {
          formatCounts.story++;
          totalSeen++;
        } else if (fmtStr.includes("post") || fmtStr.includes("image")) {
          formatCounts.post++;
          totalSeen++;
        }
      }
    }

    if (totalSeen > 0) {
      return {
        reel: formatCounts.reel / totalSeen,
        carousel: formatCounts.carousel / totalSeen,
        story: formatCounts.story / totalSeen,
        post: formatCounts.post / totalSeen,
      };
    }
    return defaults;
  } catch {
    return defaults;
  }
}


export async function computeAdaptiveRhythm(
  campaignId: string,
  accountId: string,
): Promise<AdaptiveRhythm> {
  const perfByFormat: Record<FormatKey, number | null> = {
    reel: null, carousel: null, story: null, post: null,
  };
  let hasPerformanceData = false;

  for (const fmt of FORMAT_KEYS) {
    const snaps = await db
      .select({ smoothedPerformanceScore: contentPerformanceSnapshots.smoothedPerformanceScore })
      .from(contentPerformanceSnapshots)
      .where(
        and(
          eq(contentPerformanceSnapshots.accountId, accountId),
          eq(contentPerformanceSnapshots.campaignId, campaignId),
          eq(contentPerformanceSnapshots.contentType, fmt),
        ),
      )
      .orderBy(desc(contentPerformanceSnapshots.createdAt))
      .limit(3);

    if (snaps.length > 0) {
      hasPerformanceData = true;
      const scores = snaps.map((s) => s.smoothedPerformanceScore ?? 0);
      const recencyWeights = [3, 1.5, 1];
      let wSum = 0;
      let wTotal = 0;
      for (let i = 0; i < scores.length; i++) {
        const w = recencyWeights[i] ?? 1;
        wSum += scores[i] * w;
        wTotal += w;
      }
      perfByFormat[fmt] = wTotal > 0 ? wSum / wTotal : 0;
    }
  }

  const [miSnap] = await db
    .select()
    .from(miSnapshots)
    .where(and(eq(miSnapshots.accountId, accountId), eq(miSnapshots.campaignId, campaignId)))
    .orderBy(desc(miSnapshots.createdAt))
    .limit(1);

  const compVelocity = extractCompetitorVelocity(miSnap);

  const [bizSnap] = await db
    .select()
    .from(businessDataLayer)
    .where(
      and(eq(businessDataLayer.accountId, accountId), eq(businessDataLayer.campaignId, campaignId)),
    )
    .orderBy(desc(businessDataLayer.createdAt))
    .limit(1);

  const monthlyBudget = parseBudgetToMonthly(bizSnap?.monthlyBudget || "1000");
  const totalWeeklySlots = weeklySlotBudget(monthlyBudget);

  const memBlock = await loadMemoryBlock(campaignId, accountId).catch(() => null);
  let explorationBudget = null;
  if (memBlock) {
    explorationBudget = await computeExplorationBudget(campaignId, accountId, memBlock, totalWeeklySlots).catch(() => null);
  }

  const [prevRhythmMem] = await db
    .select()
    .from(strategyMemory)
    .where(
      and(
        eq(strategyMemory.accountId, accountId),
        eq(strategyMemory.campaignId, campaignId),
        eq(strategyMemory.memoryType, "content_rhythm"),
        eq(strategyMemory.engineName, "adaptive-rhythm"),
      ),
    )
    .orderBy(desc(strategyMemory.updatedAt))
    .limit(1);

  let prevRhythm: { reels: number; carousels: number; stories: number; posts: number } | null = null;
  if (prevRhythmMem?.details) {
    try {
      prevRhythm = JSON.parse(prevRhythmMem.details);
    } catch {
      prevRhythm = null;
    }
  }

  let formatWeights: Record<string, number>;
  let performanceBasis: "performance_data" | "competitor_benchmark" | "default_balanced";
  let confidenceScore: number;
  const reasoningParts: string[] = [];

  if (hasPerformanceData) {
    performanceBasis = "performance_data";
    const rawWeights: Record<string, number> = {};
    for (const fmt of FORMAT_KEYS) {
      if (fmt === "story") {
        rawWeights.story = perfByFormat.story !== null ? Math.max(0.01, perfByFormat.story) : compVelocity.story * 0.5;
      } else {
        rawWeights[fmt] = perfByFormat[fmt] !== null
          ? Math.max(0.01, perfByFormat[fmt] as number)
          : compVelocity[fmt] * 0.5;
      }
    }
    const nonStoryTotal = rawWeights.reel + rawWeights.carousel + rawWeights.post;
    formatWeights = {
      reel: nonStoryTotal > 0 ? rawWeights.reel / nonStoryTotal : 0.55,
      carousel: nonStoryTotal > 0 ? rawWeights.carousel / nonStoryTotal : 0.30,
      story: rawWeights.story,
      post: nonStoryTotal > 0 ? rawWeights.post / nonStoryTotal : 0.15,
    };
    const dataCount = FORMAT_KEYS.filter((f) => perfByFormat[f] !== null).length;
    confidenceScore = Math.min(0.95, 0.45 + dataCount * 0.12);

    const ranked = (["reel", "carousel", "post"] as const)
      .filter((f) => perfByFormat[f] !== null)
      .sort((a, b) => (perfByFormat[b] as number) - (perfByFormat[a] as number));

    if (ranked.length >= 1) {
      const best = ranked[0];
      reasoningParts.push(
        `${capitalize(best)}s lead at score ${(perfByFormat[best] as number).toFixed(2)}`,
      );
    }
    if (ranked.length >= 2) {
      const worst = ranked[ranked.length - 1];
      reasoningParts.push(
        `${capitalize(worst)}s underperform at ${(perfByFormat[worst] as number).toFixed(2)}`,
      );
    }
  } else if (compVelocity.reel + compVelocity.carousel + compVelocity.post > 0) {
    performanceBasis = "competitor_benchmark";
    const compTotal = compVelocity.reel + compVelocity.carousel + compVelocity.post;
    formatWeights = {
      reel: compTotal > 0 ? compVelocity.reel / compTotal : 0.55,
      carousel: compTotal > 0 ? compVelocity.carousel / compTotal : 0.30,
      story: compVelocity.story,
      post: compTotal > 0 ? compVelocity.post / compTotal : 0.15,
    };
    confidenceScore = 0.35;
    reasoningParts.push("No performance data yet — using competitor posting patterns as baseline");
  } else {
    performanceBasis = "default_balanced";
    formatWeights = { reel: 0.55, carousel: 0.30, story: 0.25, post: 0.15 };
    confidenceScore = 0.25;
    reasoningParts.push("Balanced default — no performance data or competitor signals available");
  }

  const nonStorySlots = Math.round(totalWeeklySlots * 0.75);
  const rawReels = Math.max(1, Math.round(nonStorySlots * formatWeights.reel));
  const rawCarousels = Math.max(1, Math.round(nonStorySlots * formatWeights.carousel));
  const rawPosts = Math.max(1, Math.round(nonStorySlots * formatWeights.post));
  const rawStories = totalWeeklySlots >= 10 ? 2 : 1;

  const MAX_DELTA = 2;
  function stabilize(val: number, prev: number | undefined): number {
    if (prev === undefined) return val;
    return Math.max(prev - MAX_DELTA, Math.min(prev + MAX_DELTA, val));
  }

  const reelsPerWeek = stabilize(rawReels, prevRhythm?.reels);
  const carouselsPerWeek = stabilize(rawCarousels, prevRhythm?.carousels);
  const postsPerWeek = stabilize(rawPosts, prevRhythm?.posts);
  const storiesPerDay = stabilize(rawStories, prevRhythm?.stories);

  const deltaFromPrevious = {
    reels: reelsPerWeek - (prevRhythm?.reels ?? reelsPerWeek),
    carousels: carouselsPerWeek - (prevRhythm?.carousels ?? carouselsPerWeek),
    stories: storiesPerDay - (prevRhythm?.stories ?? storiesPerDay),
    posts: postsPerWeek - (prevRhythm?.posts ?? postsPerWeek),
  };

  if (prevRhythm) {
    const changes: string[] = [];
    if (deltaFromPrevious.reels !== 0) {
      changes.push(`Reels ${deltaFromPrevious.reels > 0 ? "+" : ""}${deltaFromPrevious.reels}/wk`);
    }
    if (deltaFromPrevious.carousels !== 0) {
      changes.push(
        `Carousels ${deltaFromPrevious.carousels > 0 ? "+" : ""}${deltaFromPrevious.carousels}/wk`,
      );
    }
    if (deltaFromPrevious.posts !== 0) {
      changes.push(`Posts ${deltaFromPrevious.posts > 0 ? "+" : ""}${deltaFromPrevious.posts}/wk`);
    }
    reasoningParts.push(
      changes.length > 0 ? `vs previous: ${changes.join(", ")}` : "rhythm unchanged from previous run",
    );
  }

  const reasoning = reasoningParts.join(". ");

  const newDetails = JSON.stringify({
    reels: reelsPerWeek,
    carousels: carouselsPerWeek,
    stories: storiesPerDay,
    posts: postsPerWeek,
  });
  const rhythmLabel = `Reels ${reelsPerWeek}/wk · Carousels ${carouselsPerWeek}/wk · Stories ${storiesPerDay}/day · Posts ${postsPerWeek}/wk`;

  try {
    if (prevRhythmMem) {
      await db
        .update(strategyMemory)
        .set({
          label: rhythmLabel,
          details: newDetails,
          performance: reasoning,
          score: confidenceScore,
          isWinner: true,
          updatedAt: new Date(),
        })
        .where(eq(strategyMemory.id, prevRhythmMem.id));
    } else {
      const memId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
      await db.insert(strategyMemory).values({
        id: memId,
        accountId,
        campaignId,
        memoryType: "content_rhythm",
        label: rhythmLabel,
        details: newDetails,
        performance: reasoning,
        score: confidenceScore,
        engineName: "adaptive-rhythm",
        isWinner: true,
      });
    }
  } catch (memErr: any) {
    console.warn(`[AdaptiveRhythm] Memory write failed (non-blocking):`, memErr.message);
  }

  const explorationNote = explorationBudget
    ? ` | exploration=${Math.round(explorationBudget.explorationRate * 100)}% (${explorationBudget.explorationSlots}/${totalWeeklySlots} slots)`
    : "";

  console.log(
    `[AdaptiveRhythm] reels=${reelsPerWeek}/wk carousels=${carouselsPerWeek}/wk stories=${storiesPerDay}/day posts=${postsPerWeek}/wk | basis=${performanceBasis} confidence=${confidenceScore.toFixed(2)}${explorationNote}`,
  );

  return {
    reelsPerWeek,
    carouselsPerWeek,
    storiesPerDay,
    postsPerWeek,
    reasoning: explorationBudget
      ? `${reasoning} | Exploration: ${Math.round(explorationBudget.explorationRate * 100)}% of slots (${explorationBudget.basis})`
      : reasoning,
    confidenceScore,
    performanceBasis,
    deltaFromPrevious,
  };
}
