import { db } from "../db";
import { strategyMemory, contentPerformanceSnapshots, calendarEntries, userChannelSnapshots } from "@shared/schema";
import { eq, and, gt, desc, isNotNull } from "drizzle-orm";
import { checkResultsOverrideMemory } from "../orchestrator/memory-context";
import type { MemoryClass, MemoryDirection, MemorySlot, PerformanceSnapshot } from "../memory-system/types";
import { applyFallbackSourcePenalty, DECISION_CONFIDENCE_THRESHOLDS, NON_STRATEGIC_MEMORY_TYPES } from "../decision-policy";
import { upsertByFingerprint, applyMutationUpdate } from "../memory-system/store";
import { recordMutationRun, getLatestMutationRun } from "../memory-system/mutation-log-store";

// Task #65 / Phase 2 step 5 — DECAY UNIFICATION.
// Pre-#65 there were two decay implementations:
//   (a) write-time half-life (computeDecay + applyConfidenceDecay here, plus
//       a per-format decay loop at the tail of runMemoryMutation), and
//   (b) read-time multiplicative decay (computeEffectiveConfidence in
//       manager.ts and store.ts).
// They drifted in semantics — (a) compounded with elapsed days, (b)
// compounded with elapsed read-periods — so the same row could be reported
// as "confident" by a write path and "decayed" by a read path on the same
// tick. Phase 2 removes (a) entirely; (b) is now the canonical decay layer.
// The `decayed` counter on MutationSummary is retained at 0 for the
// MemoryMutationResult schema; mutation_log keeps a "decayedCount" column
// for historical inspection.

interface MemoryMutationEntry {
  engineName: string;
  memoryType: MemoryClass;
  label: string;
  details?: string | null;
  confidenceScore?: number;
  direction?: "reinforce" | "avoid" | "neutral";
  isWinner?: boolean;
  planId?: string | null;
}

export async function applyMemoryMutation(
  campaignId: string,
  accountId: string,
  entries: MemoryMutationEntry[],
  planId: string,
): Promise<{ written: number; updated: number; decayed: number }> {
  let written = 0;
  let updated = 0;
  let decayed = 0;

  for (const entry of entries) {
    // Task #64 / Phase 1 — every strategy_memory write flows through
    // memoryStore. Direction derivation: explicit > isWinner-implied > neutral.
    // isWinner is no longer written (deprecated read-time projection).
    const direction: "reinforce" | "avoid" | "neutral" = entry.direction
      ?? (entry.isWinner === true ? "reinforce" : entry.isWinner === false ? "avoid" : "neutral");
    const confidence = entry.confidenceScore
      ?? (direction === "reinforce" ? 0.85 : direction === "avoid" ? 0.15 : 0.5);

    const result = await upsertByFingerprint({
      accountId,
      campaignId,
      memoryType: entry.memoryType,
      engineName: entry.engineName,
      label: entry.label,
      details: entry.details ?? null,
      confidenceScore: confidence,
      direction,
      planId,
      provenanceOrigin: "mutation",
    });
    if (!result.allowed) {
      console.log(`[MemoryMutation] WRITE_BLOCKED | label="${entry.label.slice(0, 60)}" confidence=${confidence} engine=${entry.engineName} reason="${result.reason}"`);
      continue;
    }
    if (result.reason === "inserted") written++;
    else updated++;
  }

  // Task #65 / Phase 2 step 5 — write-time decay removed; read-time
  // multiplicative decay (manager.computeEffectiveConfidence) is canonical.
  console.log(`[MemoryMutation] written=${written} updated=${updated} decayed=${decayed} | campaign=${campaignId}`);
  return { written, updated, decayed };
}

export async function recordWinnerMemory(
  campaignId: string,
  accountId: string,
  entry: MemoryMutationEntry,
  planId: string,
): Promise<void> {
  await applyMemoryMutation(campaignId, accountId, [{ ...entry, direction: "reinforce", isWinner: true, confidenceScore: entry.confidenceScore ?? 0.85 }], planId);
}

export async function recordAvoidMemory(
  campaignId: string,
  accountId: string,
  entry: MemoryMutationEntry,
  planId: string,
): Promise<void> {
  await applyMemoryMutation(campaignId, accountId, [{ ...entry, direction: "avoid", isWinner: false, confidenceScore: entry.confidenceScore ?? 0.15 }], planId);
}

const FORMAT_KEYWORDS: Record<string, string[]> = {
  reel: ["reel", "reels", "video reel", "short video"],
  carousel: ["carousel", "carousels", "slide", "slides", "swipe"],
  story: ["story", "stories"],
  post: ["post", "posts", "static post", "image post"],
};

const MIN_PERIODS_FOR_CONFIDENCE_MOVE = 2;
const MIN_PERIODS_FOR_FLIP = 3;
const BELOW_BASELINE_THRESHOLD = 0.15;
const CONFIDENCE_INCREMENT = 0.05;
const FLIP_RESET_CONFIDENCE = 0.35;
const INDUSTRY_BASELINE_DEFAULT = 0.5;
const MAX_SNAPSHOTS = 4;

interface MutationSummary {
  confirmed: number;
  challenged: number;
  flipped: Array<{ label: string; from: MemoryDirection; to: MemoryDirection }>;
  decayed: number;
  totalProcessed: number;
}

export interface MemoryMutationResult {
  summary: MutationSummary;
  logEntryId: string;
}

export interface MemoryHealthSummary {
  totalActive: number;
  highConfidenceCount: number;
  challengedCount: number;
  recentlyDecayed: number;
  recentFlips: Array<{ label: string; from: string; to: string }>;
  lastMutationRunAt: Date | null;
}

function detectContentFormat(slot: { label: string; details: string | null }): string | null {
  const lbl = ((slot.label ?? "") + " " + (slot.details ?? "")).toLowerCase();
  for (const [fmt, keywords] of Object.entries(FORMAT_KEYWORDS)) {
    if (keywords.some((k) => lbl.includes(k))) return fmt;
  }
  return null;
}

function toPerformanceSnapshots(
  rows: Array<{ smoothedPerformanceScore: number | null; createdAt: Date | null }>,
  industryBaseline: number,
): PerformanceSnapshot[] {
  return rows.map((r) => ({
    contentFormat: "unknown",
    performanceScore: r.smoothedPerformanceScore ?? 0,
    industryBaselineScore: industryBaseline,
    recordedAt: r.createdAt ?? new Date(),
  }));
}

function countConsecutiveConfirmed(
  scores: number[],
  industryBaseline: number,
  direction: "above" | "below",
  thresholdFraction: number = 0,
): number {
  let count = 0;
  for (const score of scores) {
    const threshold =
      direction === "above"
        ? industryBaseline * (1 + thresholdFraction)
        : industryBaseline * (1 - thresholdFraction);
    const passes = direction === "above" ? score >= threshold : score < threshold;
    if (passes) count++;
    else break;
  }
  return count;
}

async function processExplorationResults(
  accountId: string,
  campaignId: string,
  industryBaseline: number,
): Promise<void> {
  try {
    const explorationEntries = await db
      .select({
        contentType: calendarEntries.contentType,
        explorationHypothesis: calendarEntries.explorationHypothesis,
        scheduledDate: calendarEntries.scheduledDate,
        createdAt: calendarEntries.createdAt,
      })
      .from(calendarEntries)
      .where(
        and(
          eq(calendarEntries.accountId, accountId),
          eq(calendarEntries.campaignId, campaignId),
          eq(calendarEntries.isExploration, true),
        ),
      )
      .limit(100);

    if (explorationEntries.length === 0) return;

    const formatGroups = new Map<string, { explorationWindowStart: Date; explorationWindowEnd: Date; hypothesis: string | null }>();
    for (const entry of explorationEntries) {
      const fmt = entry.contentType.toLowerCase();
      const scheduledTs = entry.scheduledDate ? new Date(entry.scheduledDate) : (entry.createdAt ?? new Date(0));
      if (isNaN(scheduledTs.getTime())) continue;
      const existing = formatGroups.get(fmt);
      if (!existing) {
        formatGroups.set(fmt, { explorationWindowStart: scheduledTs, explorationWindowEnd: scheduledTs, hypothesis: entry.explorationHypothesis });
      } else {
        if (scheduledTs < existing.explorationWindowStart) existing.explorationWindowStart = scheduledTs;
        if (scheduledTs > existing.explorationWindowEnd) existing.explorationWindowEnd = scheduledTs;
      }
    }

    for (const [fmt, { explorationWindowStart, explorationWindowEnd, hypothesis }] of formatGroups) {
      const windowEnd = new Date(explorationWindowEnd.getTime() + 7 * 24 * 60 * 60 * 1000);
      const snaps = await db
        .select({
          smoothedPerformanceScore: contentPerformanceSnapshots.smoothedPerformanceScore,
          createdAt: contentPerformanceSnapshots.createdAt,
        })
        .from(contentPerformanceSnapshots)
        .where(
          and(
            eq(contentPerformanceSnapshots.accountId, accountId),
            eq(contentPerformanceSnapshots.campaignId, campaignId),
            eq(contentPerformanceSnapshots.contentType, fmt),
            gt(contentPerformanceSnapshots.createdAt, explorationWindowStart),
          ),
        )
        .orderBy(desc(contentPerformanceSnapshots.createdAt))
        .limit(3);

      const inWindowSnaps = snaps.filter((s) => !s.createdAt || s.createdAt <= windowEnd);

      if (inWindowSnaps.length === 0) continue;

      const strongPeriods = inWindowSnaps.filter((s) => (s.smoothedPerformanceScore ?? 0) >= industryBaseline);

      const PROVISIONAL_PERIODS_REQUIRED = DECISION_CONFIDENCE_THRESHOLDS.PROVISIONAL_WRITE_PERIODS_REQUIRED;
      const PROVISIONAL_CONFIDENCE = DECISION_CONFIDENCE_THRESHOLDS.MEMORY_WRITE_MIN;

      if (strongPeriods.length < PROVISIONAL_PERIODS_REQUIRED) {
        console.log(
          `[MemoryMutation] MEMORY_WRITE_BLOCKED | format=${fmt} strongPeriods=${strongPeriods.length} required=${PROVISIONAL_PERIODS_REQUIRED} ` +
          `reason="Insufficient qualifying periods for provisional reinforce — policy requires ${PROVISIONAL_PERIODS_REQUIRED} periods above baseline"`,
        );
      } else {
        const existingProvisional = await db
          .select({ id: strategyMemory.id, label: strategyMemory.label })
          .from(strategyMemory)
          .where(
            and(
              eq(strategyMemory.accountId, accountId),
              eq(strategyMemory.campaignId, campaignId),
              eq(strategyMemory.engineName, "exploration-result"),
            ),
          )
          .limit(100);

        const alreadyExists = existingProvisional.some(
          (r) => r.label.toLowerCase().includes(fmt),
        );

        if (!alreadyExists) {
          const details = hypothesis || `${fmt} showed above-baseline performance during exploration (${strongPeriods.length} qualifying period(s) — policy minimum: ${PROVISIONAL_PERIODS_REQUIRED}).`;
          const result = await upsertByFingerprint({
            accountId,
            campaignId,
            memoryType: "content_distribution",
            engineName: "exploration-result",
            label: `${fmt} exploration result — provisional reinforce`,
            details,
            confidenceScore: PROVISIONAL_CONFIDENCE,
            direction: "reinforce",
            provenanceOrigin: "exploration",
          });
          if (!result.allowed) {
            console.log(`[MemoryMutation] MEMORY_WRITE_BLOCKED | format=${fmt} reason="${result.reason}"`);
          } else {
            console.log(`[MemoryMutation] EXPLORATION_RESULT | format=${fmt} baseline=${industryBaseline.toFixed(3)} strongPeriods=${strongPeriods.length} windowStart=${explorationWindowStart.toISOString()} windowEnd=${windowEnd.toISOString()} → provisional reinforce created`);
          }
        }
      }
    }
  } catch (err: any) {
    console.warn(`[MemoryMutation] processExplorationResults error (non-blocking): ${err.message}`);
  }
}

async function resolveIndustryBaseline(accountId: string, campaignId: string): Promise<number> {
  try {
    const { loadMemoryBlock } = await import("../memory-system/manager");
    const block = await loadMemoryBlock(campaignId, accountId, null, null);
    const bl = block.industryBaseline;
    if (bl) {
      const avg =
        (bl.reelsPerWeek + bl.postsPerWeek + bl.storiesPerDay + bl.carouselsPerWeek) / 4;
      return avg > 0 ? Math.min(1.0, avg / 10) : INDUSTRY_BASELINE_DEFAULT;
    }
  } catch (err: any) {
    // Seal #15 silent-degradation rules — no bare catch on a trusted read.
    console.error(
      `[MemoryMutation] INDUSTRY_BASELINE_READ_FAILED | account=${accountId} campaign=${campaignId} ` +
      `err="${err?.message ?? String(err)}" — falling back to INDUSTRY_BASELINE_DEFAULT=${INDUSTRY_BASELINE_DEFAULT}`,
    );
  }
  return INDUSTRY_BASELINE_DEFAULT;
}

// ── Scrape Health Guard ────────────────────────────────────────────────────────

const CONSECUTIVE_FAILED_THRESHOLD = 3;

/**
 * Returns true if the most recent N snapshots for this account are all FAILED.
 * When an account is degraded the signal cannot be trusted, so memory mutation
 * is skipped entirely to protect memory integrity.
 */
async function checkScrapeHealthForAccount(
  accountId: string,
): Promise<{ isDegraded: boolean; consecutiveFailed: number }> {
  const recentSnaps = await db
    .select({ snapshotData: userChannelSnapshots.snapshotData })
    .from(userChannelSnapshots)
    .where(eq(userChannelSnapshots.accountId, accountId))
    .orderBy(desc(userChannelSnapshots.scrapedAt))
    .limit(CONSECUTIVE_FAILED_THRESHOLD);

  let consecutiveFailed = 0;
  for (const snap of recentSnaps) {
    try {
      const data = snap.snapshotData ? JSON.parse(snap.snapshotData) : null;
      if (data?.scrapeStatus === "FAILED") {
        consecutiveFailed++;
      } else {
        break;
      }
    } catch (err: any) {
      // Seal #15 — corrupt snapshot rows shouldn't be silently squelched.
      console.error(
        `[MemoryMutation] SNAPSHOT_PARSE_FAILED | account=${accountId} ` +
        `err="${err?.message ?? String(err)}" — treating as non-FAILED and ending degradation scan.`,
      );
      break;
    }
  }

  return {
    isDegraded: consecutiveFailed >= CONSECUTIVE_FAILED_THRESHOLD,
    consecutiveFailed,
  };
}

export async function runMemoryMutation(
  accountId: string,
  campaignId: string,
): Promise<MemoryMutationResult> {
  // ── Degradation guard ────────────────────────────────────────────────────────
  // If the account's last 3 channel scrapes all failed, the performance signal
  // is unreliable. Skip mutation entirely rather than risk corrupting memory
  // with bad data (e.g. false "zero engagement" from a blocked scrape).
  const scrapeHealth = await checkScrapeHealthForAccount(accountId);
  if (scrapeHealth.isDegraded) {
    console.warn(
      `[MemoryMutation] Skipping mutation for account=${accountId} — ` +
      `${scrapeHealth.consecutiveFailed} consecutive FAILED scrapes detected. ` +
      `Signal integrity compromised. Memory unchanged.`
    );
    return {
      summary: { confirmed: 0, challenged: 0, flipped: [], decayed: 0, totalProcessed: 0 },
      logEntryId: "degraded-skip",
    };
  }

  const memoryRows = await db
    .select()
    .from(strategyMemory)
    .where(
      and(
        eq(strategyMemory.accountId, accountId),
        eq(strategyMemory.campaignId, campaignId),
        isNotNull(strategyMemory.direction),
        isNotNull(strategyMemory.confidenceScore),
      ),
    )
    .orderBy(desc(strategyMemory.createdAt));

  const NON_STRATEGIC_SET = new Set<string>(NON_STRATEGIC_MEMORY_TYPES);
  const eligible = memoryRows.filter(
    (r) =>
      r.direction !== null &&
      r.direction !== "neutral" &&
      !NON_STRATEGIC_SET.has(r.memoryType ?? ""),
  );

  const summary: MutationSummary = {
    confirmed: 0,
    challenged: 0,
    flipped: [],
    decayed: 0,
    totalProcessed: eligible.length,
  };

  const industryBaseline = await resolveIndustryBaseline(accountId, campaignId);

  const validatedIds = new Set<string>();
  const challengedEntryIds = new Set<string>();

  for (const row of eligible) {
    const fmt = detectContentFormat({ label: row.label, details: row.details ?? null });
    if (!fmt) continue;

    const sinceDate = row.lastValidatedAt ?? undefined;

    const baseConditions = and(
      eq(contentPerformanceSnapshots.accountId, accountId),
      eq(contentPerformanceSnapshots.campaignId, campaignId),
      eq(contentPerformanceSnapshots.contentType, fmt),
      ...(sinceDate ? [gt(contentPerformanceSnapshots.createdAt, sinceDate)] : []),
    );

    // ── Source priority: channel-scrape (primary) → all sources (fallback) ───
    // Channel-scraped signals are the primary truth: they are collected automatically
    // from the user's own Instagram channel and reflect real audience behaviour.
    // Manual / Meta-API snapshots serve as secondary validation only when channel
    // data is insufficient (< MIN_PERIODS_FOR_CONFIDENCE_MOVE).
    const channelSnaps = await db
      .select({
        smoothedPerformanceScore: contentPerformanceSnapshots.smoothedPerformanceScore,
        createdAt: contentPerformanceSnapshots.createdAt,
      })
      .from(contentPerformanceSnapshots)
      .where(and(baseConditions, eq(contentPerformanceSnapshots.source, "channel-scrape")))
      .orderBy(desc(contentPerformanceSnapshots.createdAt))
      .limit(MAX_SNAPSHOTS);

    const usingChannelAsPrimary = channelSnaps.length >= MIN_PERIODS_FOR_CONFIDENCE_MOVE;

    const newSnaps = usingChannelAsPrimary
      ? channelSnaps
      : await db
          .select({
            smoothedPerformanceScore: contentPerformanceSnapshots.smoothedPerformanceScore,
            createdAt: contentPerformanceSnapshots.createdAt,
          })
          .from(contentPerformanceSnapshots)
          .where(baseConditions)
          .orderBy(desc(contentPerformanceSnapshots.createdAt))
          .limit(MAX_SNAPSHOTS);

    if (!usingChannelAsPrimary && newSnaps.length > 0) {
      console.warn(
        `[MemoryMutation] MEMORY_FALLBACK_SOURCE_ACTIVE | format=${fmt} snaps=${newSnaps.length} ` +
        `reason="channel-scrape insufficient (${channelSnaps.length}/${MIN_PERIODS_FOR_CONFIDENCE_MOVE}) — using all-sources fallback. ` +
        `Confidence penalty of ${DECISION_CONFIDENCE_THRESHOLDS.FALLBACK_SOURCE_PENALTY} will be applied to any memory writes from this signal."`,
      );
    }

    console.log(
      `[MemoryMutation] format=${fmt} signalSource=${usingChannelAsPrimary ? "channel-scrape (primary)" : "all-sources (fallback)"} snaps=${newSnaps.length}`,
    );

    if (newSnaps.length < MIN_PERIODS_FOR_CONFIDENCE_MOVE) continue;

    validatedIds.add(row.id);

    const scores = newSnaps.map((s) => s.smoothedPerformanceScore ?? 0);
    const currentDirection = (row.direction ?? "neutral") as MemoryDirection;
    const rawConfidence = row.confidenceScore ?? 0.5;
    const currentValidationCount = row.validationCount ?? 0;

    let currentConfidence = rawConfidence;
    if (!usingChannelAsPrimary) {
      const penaltyResult = applyFallbackSourcePenalty(rawConfidence, row.label);
      currentConfidence = penaltyResult.penalizedScore;
    }

    if (currentDirection === "reinforce") {
      const consistentAbove = countConsecutiveConfirmed(scores, industryBaseline, "above");
      const challengedPeriods = countConsecutiveConfirmed(
        scores,
        industryBaseline,
        "below",
        BELOW_BASELINE_THRESHOLD,
      );

      if (consistentAbove >= MIN_PERIODS_FOR_CONFIDENCE_MOVE) {
        const newConfidence = Math.min(1.0, currentConfidence + CONFIDENCE_INCREMENT * consistentAbove);
        await applyMutationUpdate(row.id, {
          kind: "confirm",
          confidenceScore: newConfidence,
          validationCount: currentValidationCount + consistentAbove,
        });
        console.log(`[MemoryMutation] CONFIRMED | label="${row.label.slice(0, 60)}" periods=${consistentAbove} confidence=${currentConfidence.toFixed(3)}→${newConfidence.toFixed(3)} scores=[${scores.slice(0, 4).map(s => s.toFixed(2)).join(",")}] baseline=${industryBaseline.toFixed(2)}`);
        summary.confirmed++;
      } else if (challengedPeriods >= MIN_PERIODS_FOR_FLIP) {
        await applyMutationUpdate(row.id, {
          kind: "flip",
          direction: "avoid",
          confidenceScore: FLIP_RESET_CONFIDENCE,
        });
        console.log(`[MemoryMutation] FLIPPED | label="${row.label.slice(0, 60)}" from=reinforce to=avoid periods=${challengedPeriods} confidence=${currentConfidence.toFixed(3)}→${FLIP_RESET_CONFIDENCE} scores=[${scores.slice(0, 4).map(s => s.toFixed(2)).join(",")}] baseline=${industryBaseline.toFixed(2)}`);
        summary.flipped.push({ label: row.label, from: "reinforce", to: "avoid" });
        summary.challenged++;
        challengedEntryIds.add(row.id);
      } else if (challengedPeriods >= MIN_PERIODS_FOR_CONFIDENCE_MOVE) {
        console.log(`[MemoryMutation] CHALLENGED | label="${row.label.slice(0, 60)}" periods=${challengedPeriods} confidence=${currentConfidence.toFixed(3)} scores=[${scores.slice(0, 4).map(s => s.toFixed(2)).join(",")}] baseline=${industryBaseline.toFixed(2)}`);
        summary.challenged++;
        challengedEntryIds.add(row.id);
      }
    } else if (currentDirection === "avoid") {
      const asSlot: MemorySlot = {
        id: row.id,
        accountId: row.accountId,
        campaignId: row.campaignId,
        memoryType: (row.memoryType ?? "content_format") as import("../memory-system/types").MemoryClass,
        engineName: row.engineName ?? null,
        label: row.label,
        details: row.details ?? null,
        performance: null,
        score: row.score ?? 0,
        confidenceScore: currentConfidence,
        direction: currentDirection,
        isWinner: row.isWinner ?? false,
        usageCount: row.usageCount ?? 0,
        planId: row.planId ?? null,
        strategyFingerprint: row.strategyFingerprint ?? null,
        lastValidatedAt: row.lastValidatedAt ?? null,
        decayRate: row.decayRate ?? 0.95,
        validationCount: currentValidationCount,
        industry: null,
        platform: null,
        campaignType: null,
        funnelObjective: null,
        updatedAt: row.updatedAt ?? null,
        createdAt: row.createdAt ?? null,
      };

      const perfSnaps = toPerformanceSnapshots(newSnaps, industryBaseline);
      const overrideResult = checkResultsOverrideMemory(asSlot, perfSnaps);

      const consistentBelow = countConsecutiveConfirmed(scores, industryBaseline, "below");
      const consistentAboveForAvoid = countConsecutiveConfirmed(scores, industryBaseline, "above");

      if (overrideResult.override) {
        await applyMutationUpdate(row.id, {
          kind: "flip",
          direction: "reinforce",
          confidenceScore: FLIP_RESET_CONFIDENCE,
        });
        console.log(`[MemoryMutation] FLIPPED | label="${row.label.slice(0, 60)}" from=avoid to=reinforce reason=results_override confidence=${currentConfidence.toFixed(3)}→${FLIP_RESET_CONFIDENCE} scores=[${scores.slice(0, 4).map(s => s.toFixed(2)).join(",")}] baseline=${industryBaseline.toFixed(2)}`);
        summary.flipped.push({ label: row.label, from: "avoid", to: "reinforce" });
        summary.confirmed++;
      } else if (consistentBelow >= MIN_PERIODS_FOR_CONFIDENCE_MOVE) {
        const newConfidence = Math.min(1.0, currentConfidence + CONFIDENCE_INCREMENT * consistentBelow);
        await applyMutationUpdate(row.id, {
          kind: "confirm",
          confidenceScore: newConfidence,
          validationCount: currentValidationCount + consistentBelow,
        });
        console.log(`[MemoryMutation] AVOID_CONFIRMED | label="${row.label.slice(0, 60)}" periods=${consistentBelow} confidence=${currentConfidence.toFixed(3)}→${newConfidence.toFixed(3)} scores=[${scores.slice(0, 4).map(s => s.toFixed(2)).join(",")}] baseline=${industryBaseline.toFixed(2)}`);
        summary.confirmed++;
      } else if (consistentAboveForAvoid >= MIN_PERIODS_FOR_CONFIDENCE_MOVE && !overrideResult.override) {
        console.log(`[MemoryMutation] AVOID_CHALLENGED | label="${row.label.slice(0, 60)}" periods=${consistentAboveForAvoid} confidence=${currentConfidence.toFixed(3)} scores=[${scores.slice(0, 4).map(s => s.toFixed(2)).join(",")}] baseline=${industryBaseline.toFixed(2)}`);
        summary.challenged++;
        challengedEntryIds.add(row.id);
      }
    }
  }

  // Task #65 / Phase 2 step 5 — the per-row write-time decay loop that used
  // to live here is removed. Read-time multiplicative decay in
  // computeEffectiveConfidence is the single canonical decay layer; writing
  // a decayed value back to the row corrupted the provenance audit (decay
  // writes appeared in CV-06 as ordinary "updated" events from
  // engine="memory-mutation" with no source outcome).
  // summary.decayed stays at 0; mutation_log's decayed_count column is kept
  // for historical schema compat.

  await processExplorationResults(accountId, campaignId, industryBaseline);

  // Task #64 / Phase 1 — mutation_log persisted to its dedicated table.
  const logId = await recordMutationRun({
    accountId,
    campaignId,
    label: `Mutation — ${summary.confirmed} confirmed, ${summary.challenged} challenged, ${summary.flipped.length} flipped, ${summary.decayed} decayed`,
    confirmedCount: summary.confirmed,
    challengedCount: summary.challenged,
    flippedCount: summary.flipped.length,
    decayedCount: summary.decayed,
    totalProcessed: summary.totalProcessed,
    challengedIds: Array.from(challengedEntryIds),
    flipped: summary.flipped,
  });

  console.log(
    `[MemoryMutation] RUN_COMPLETE | account=${accountId} campaign=${campaignId} | processed=${summary.totalProcessed} confirmed=${summary.confirmed} challenged=${summary.challenged} flipped=${summary.flipped.length} decayed=${summary.decayed}`,
  );

  return { summary, logEntryId: logId };
}

export async function getMemoryHealth(
  accountId: string,
  campaignId: string,
): Promise<MemoryHealthSummary> {
  // Task #64 / Phase 1 — read split:
  //   • Active strategic facts come from strategy_memory (filtered to exclude
  //     legacy operational/log rows that may still exist pre-sweep).
  //   • Audit history comes from the dedicated mutation_log table.
  const rows = await db
    .select()
    .from(strategyMemory)
    .where(
      and(
        eq(strategyMemory.accountId, accountId),
        eq(strategyMemory.campaignId, campaignId),
      ),
    )
    .orderBy(desc(strategyMemory.createdAt));

  const NON_STRATEGIC_HEALTH_SET = new Set<string>(NON_STRATEGIC_MEMORY_TYPES);
  const activeEntries = rows.filter(
    (r) =>
      !NON_STRATEGIC_HEALTH_SET.has(r.memoryType ?? "") &&
      r.direction !== null &&
      r.direction !== "neutral",
  );
  const highConfidenceCount = activeEntries.filter((r) => (r.confidenceScore ?? 0) > 0.7).length;

  const logEntry = await getLatestMutationRun(accountId, campaignId);
  let recentFlips: Array<{ label: string; from: string; to: string }> = [];
  let recentlyDecayed = 0;
  let challengedCount = 0;
  let lastMutationRunAt: Date | null = null;
  if (logEntry) {
    lastMutationRunAt = logEntry.createdAt ?? null;
    recentFlips = (logEntry.flipped ?? []) as typeof recentFlips;
    recentlyDecayed = logEntry.decayedCount ?? 0;
    challengedCount = (logEntry.challengedIds ?? []).length;
  }

  return {
    totalActive: activeEntries.length,
    highConfidenceCount,
    challengedCount,
    recentlyDecayed,
    recentFlips,
    lastMutationRunAt,
  };
}
