import { db } from "../db";
import { strategyMemory } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { aiChat } from "../ai-client";
import type { MemoryBlock, IndustryBaseline } from "../memory-system/types";
import type { SynthesizedPlan } from "../orchestrator/plan-synthesis";

export interface ExplorationSlot {
  format: string;
  count: number;
  intent: "retest" | "discovery";
  hypothesis: string;
}

export interface ExplorationBudget {
  explorationPercent: number;
  explorationSlots: ExplorationSlot[];
  rationale: string;
  totalExplorationCount: number;
}

export interface LegacyExplorationBudget {
  explorationRate: number;
  exploitationRate: number;
  explorationSlots: number;
  totalWeeklySlots: number;
  rationale: string;
  confidenceScore: number;
  basis: "performance_driven" | "memory_driven" | "default";
}

const MIN_EXPLORATION_PCT = 10;
const MAX_EXPLORATION_PCT = 35;
const BASE_EXPLORATION_PCT = 20;

const CONTENT_FORMATS = ["reel", "carousel", "story", "post"] as const;
type ContentFormat = typeof CONTENT_FORMATS[number];

function formatFromDistribution(
  plan: SynthesizedPlan,
): Record<ContentFormat, number> {
  return {
    reel: plan.contentDistribution.reelsPerWeek,
    carousel: plan.contentDistribution.carouselsPerWeek,
    story: plan.contentDistribution.storiesPerDay * 7,
    post: plan.contentDistribution.postsPerWeek,
  };
}

function totalWeeklyVolume(dist: Record<ContentFormat, number>): number {
  return Object.values(dist).reduce((sum, v) => sum + v, 0);
}

async function generateHypothesis(
  format: string,
  intent: "retest" | "discovery",
  confidenceScore: number | null,
  accountId: string,
): Promise<string> {
  try {
    const prompt = intent === "retest"
      ? `A content format was previously avoided but has low confidence (score: ${(confidenceScore ?? 0.3).toFixed(2)}). Format: "${format}". In one short sentence, what is the hypothesis for retesting it this period?`
      : `A content format has never been tested. Format: "${format}". In one short sentence, what is the discovery hypothesis for testing it this period?`;

    const response = await aiChat({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 80,
      accountId,
      endpoint: "exploration-budget-hypothesis",
    });
    const text = response.choices[0]?.message?.content?.trim() || "";
    return text || defaultHypothesis(format, intent);
  } catch {
    return defaultHypothesis(format, intent);
  }
}

function defaultHypothesis(format: string, intent: "retest" | "discovery"): string {
  if (intent === "retest") {
    return `Retesting ${format} with updated creative approach to validate whether past underperformance was format-specific or execution-specific.`;
  }
  return `Introducing ${format} as a new format to measure baseline audience response and identify potential engagement lift.`;
}

export async function computeExplorationBudget(
  plan: SynthesizedPlan,
  baseline: IndustryBaseline | null,
  memoryBlock: MemoryBlock,
  campaignId: string,
  accountId: string,
  campaignExplorationBudgetPercent?: number | null,
): Promise<ExplorationBudget> {
  const highConfidenceEntries = memoryBlock.reinforceSlots.filter(
    (s) => s.confidenceScore > 0.7,
  ).length;

  const challengedEntries = memoryBlock.avoidSlots.filter(
    (s) => s.confidenceScore < 0.6,
  ).length;

  let explorationPercent: number;
  if (campaignExplorationBudgetPercent != null) {
    explorationPercent = Math.min(MAX_EXPLORATION_PCT, Math.max(MIN_EXPLORATION_PCT, campaignExplorationBudgetPercent));
  } else {
    const rawPct =
      BASE_EXPLORATION_PCT +
      challengedEntries * 2 -
      highConfidenceEntries * 1;
    explorationPercent = Math.min(MAX_EXPLORATION_PCT, Math.max(MIN_EXPLORATION_PCT, rawPct));
  }

  const formatDist = formatFromDistribution(plan);
  const weeklyTotal = totalWeeklyVolume(formatDist);
  const explorationCount = Math.max(
    1,
    Math.round((weeklyTotal * explorationPercent) / 100),
  );

  const avoidFormats: Array<{ format: string; confidence: number }> = [];
  const testedFormats = new Set<string>();

  for (const slot of memoryBlock.reinforceSlots) {
    const fmt = detectFormat(slot.label);
    if (fmt) testedFormats.add(fmt);
  }
  for (const slot of memoryBlock.avoidSlots) {
    const fmt = detectFormat(slot.label);
    if (fmt) testedFormats.add(fmt);
  }

  for (const slot of memoryBlock.avoidSlots) {
    if ((slot.confidenceScore ?? 1) >= 0.75) continue;
    const fmt = detectFormat(slot.label);
    if (!fmt) continue;
    avoidFormats.push({ format: fmt, confidence: slot.confidenceScore ?? 0.3 });
  }

  const discoveryFormats = CONTENT_FORMATS.filter(
    (f) => !testedFormats.has(f),
  );

  const candidateSlots: ExplorationSlot[] = [];
  let slotsRemaining = explorationCount;

  for (const { format, confidence } of avoidFormats) {
    if (slotsRemaining <= 0) break;
    const count = Math.max(1, Math.round(slotsRemaining / Math.max(1, avoidFormats.length)));
    const actualCount = Math.min(count, slotsRemaining);
    const hypothesis = await generateHypothesis(format, "retest", confidence, accountId);
    candidateSlots.push({ format, count: actualCount, intent: "retest", hypothesis });
    slotsRemaining -= actualCount;
  }

  for (const format of discoveryFormats) {
    if (slotsRemaining <= 0) break;
    const count = Math.min(1, slotsRemaining);
    const hypothesis = await generateHypothesis(format, "discovery", null, accountId);
    candidateSlots.push({ format, count, intent: "discovery", hypothesis });
    slotsRemaining -= count;
  }

  if (candidateSlots.length === 0 && explorationCount > 0) {
    const fallbackFormat = CONTENT_FORMATS.find((f) => (formatDist[f] ?? 0) < 2) ?? "reel";
    const hypothesis = await generateHypothesis(fallbackFormat, "discovery", null, accountId);
    candidateSlots.push({ format: fallbackFormat, count: explorationCount, intent: "discovery", hypothesis });
  }

  const rationale = buildRationale(
    explorationPercent,
    BASE_EXPLORATION_PCT,
    highConfidenceEntries,
    challengedEntries,
    explorationCount,
    weeklyTotal,
    candidateSlots,
  );

  await persistExplorationBudget(campaignId, accountId, explorationPercent, explorationCount, weeklyTotal, rationale, candidateSlots);

  console.log(
    `[ExplorationBudget] campaign=${campaignId} pct=${explorationPercent}% slots=${explorationCount}/${weeklyTotal} retest=${candidateSlots.filter((s) => s.intent === "retest").length} discovery=${candidateSlots.filter((s) => s.intent === "discovery").length}`,
  );

  return {
    explorationPercent,
    explorationSlots: candidateSlots,
    rationale,
    totalExplorationCount: explorationCount,
  };
}

function detectFormat(label: string): ContentFormat | null {
  const l = label.toLowerCase();
  if (l.includes("reel") || l.includes("short video")) return "reel";
  if (l.includes("carousel") || l.includes("slide") || l.includes("swipe")) return "carousel";
  if (l.includes("story") || l.includes("stories")) return "story";
  if (l.includes("post") || l.includes("image post") || l.includes("static")) return "post";
  return null;
}

function buildRationale(
  explorationPercent: number,
  basePct: number,
  highConf: number,
  challenged: number,
  explorationCount: number,
  weeklyTotal: number,
  slots: ExplorationSlot[],
): string {
  const parts: string[] = [];
  parts.push(
    `Exploration budget: ${explorationPercent}% (base ${basePct}%${highConf > 0 ? ` −${highConf}% from ${highConf} high-confidence entries` : ""}${challenged > 0 ? ` +${challenged * 2}% from ${challenged} low-confidence avoids` : ""}).`,
  );
  parts.push(`${explorationCount} of ${weeklyTotal} weekly slots allocated to exploration.`);
  const retests = slots.filter((s) => s.intent === "retest");
  const discoveries = slots.filter((s) => s.intent === "discovery");
  if (retests.length > 0) parts.push(`Retesting: ${retests.map((s) => s.format).join(", ")}.`);
  if (discoveries.length > 0) parts.push(`Discovering: ${discoveries.map((s) => s.format).join(", ")}.`);
  return parts.join(" ");
}

async function persistExplorationBudget(
  campaignId: string,
  accountId: string,
  explorationPercent: number,
  explorationCount: number,
  weeklyTotal: number,
  rationale: string,
  slots: ExplorationSlot[],
): Promise<void> {
  const label = `Exploration Budget: ${explorationPercent}% (${explorationCount}/${weeklyTotal} slots/week)`;
  const details = JSON.stringify({ explorationPercent, explorationCount, weeklyTotal, slots, rationale });

  const existing = await db
    .select()
    .from(strategyMemory)
    .where(
      and(
        eq(strategyMemory.accountId, accountId),
        eq(strategyMemory.campaignId, campaignId),
        eq(strategyMemory.memoryType, "exploration_budget"),
        eq(strategyMemory.engineName, "exploration-budget"),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(strategyMemory)
      .set({ label, details, performance: rationale, lastValidatedAt: new Date(), updatedAt: new Date() })
      .where(eq(strategyMemory.id, existing[0].id));
  } else {
    const memId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    await db.insert(strategyMemory).values({
      id: memId,
      accountId,
      campaignId,
      memoryType: "exploration_budget",
      engineName: "exploration-budget",
      label,
      details,
      performance: rationale,
      score: 0.5,
      isWinner: false,
      confidenceScore: 0.5,
      direction: "neutral",
      lastValidatedAt: new Date(),
    });
  }
}

export async function computeLegacyExplorationBudget(
  campaignId: string,
  accountId: string,
  memoryBlock: MemoryBlock,
  totalWeeklySlots: number,
): Promise<LegacyExplorationBudget> {
  const reinforceSlots = memoryBlock.reinforceSlots;
  const avoidSlots = memoryBlock.avoidSlots;

  const MIN_EXPLORATION_RATE = 0.10;
  const MAX_EXPLORATION_RATE = 0.40;
  const DEFAULT_EXPLORATION_RATE = 0.20;

  function clamp(v: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, v));
  }

  let explorationRate = DEFAULT_EXPLORATION_RATE;
  let basis: "performance_driven" | "memory_driven" | "default" = "default";
  let rationale = "No performance data or memory context — using default 20% exploration.";

  if (reinforceSlots.length > 0) {
    const avgConf = reinforceSlots.reduce((s, r) => s + r.confidenceScore, 0) / reinforceSlots.length;
    explorationRate = avgConf >= 0.8 ? 0.10 : avgConf >= 0.6 ? 0.15 : avgConf >= 0.4 ? 0.20 : avgConf >= 0.2 ? 0.30 : 0.40;
    rationale = `Memory-driven: ${reinforceSlots.length} reinforced patterns (avg confidence ${avgConf.toFixed(2)}) — exploration at ${Math.round(explorationRate * 100)}%.`;
    basis = "memory_driven";
  }

  if (avoidSlots.length > 0) {
    explorationRate = clamp(explorationRate + 0.05 * Math.min(3, avoidSlots.length), MIN_EXPLORATION_RATE, MAX_EXPLORATION_RATE);
    rationale += ` ${avoidSlots.length} avoid-patterns detected — exploration slightly increased.`;
  }

  explorationRate = clamp(explorationRate, MIN_EXPLORATION_RATE, MAX_EXPLORATION_RATE);
  const exploitationRate = 1 - explorationRate;
  const explorationSlotsCount = Math.max(1, Math.round(totalWeeklySlots * explorationRate));
  const confidenceScore = basis === "memory_driven" ? 0.55 : 0.3;

  return {
    explorationRate,
    exploitationRate,
    explorationSlots: explorationSlotsCount,
    totalWeeklySlots,
    rationale,
    confidenceScore,
    basis,
  };
}
