/**
 * Watchtower Distribution Intelligence Layer (P-3 Enhancement)
 *
 * Deterministic market-structure analysis built on competitor_post_classifications.
 * Complements — does NOT replace — the semantic shift detection engine in
 * orchestrator.ts. Shift detection answers "what changed per competitor?";
 * this module answers "what does the market look like, what is growing,
 * what is declining, what dominates?"
 *
 * Doctrine:
 *   - ZERO LLM calls. Pure SQL load + deterministic aggregation.
 *   - competitor_post_classifications is the single semantic source of truth.
 *   - One DB query per snapshot (avoid duplicate calculations); results are
 *     cached in-process for 5 minutes per (campaign, window).
 *   - Market observations only — no strategic recommendations.
 */

import { and, eq, gte, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  competitorPostClassifications,
  ciCompetitorPosts,
  ciCompetitors,
} from "../../shared/schema";

const LOG_PREFIX = "[DistributionIntel]";

// ── tunables ──────────────────────────────────────────────────────────────────
const CLASSIFIER_VERSION = "competitor-post-v2";
const MIN_CONFIDENCE = 0.5;            // same floor as shift detection
const MIN_WINDOW_POSTS = 5;            // below → dataStatus=insufficient
const THIN_WINDOW_POSTS = 12;          // below → dataStatus=thin
const LEADER_TREND_THRESHOLD_PP = 5;   // leader share delta to call rising/falling
// Emerging pattern gates (brief §4: adoption threshold, competitor count,
// confidence, noise filtering)
const EMERGING_MIN_DELTA_PP = 10;
const EMERGING_MIN_SHARE = 15;         // % of current window
const EMERGING_MIN_COMPETITORS = 2;
const EMERGING_MIN_POSTS = 3;
// Declining pattern gates (mirror of emerging)
const DECLINING_MIN_DELTA_PP = 10;
const DECLINING_MIN_PREV_SHARE = 15;
const DECLINING_MIN_PREV_POSTS = 3;
const CACHE_TTL_MS = 5 * 60_000;
const ALLOWED_WINDOWS = [7, 30, 90] as const;
export type WindowDays = (typeof ALLOWED_WINDOWS)[number];

export function normalizeWindow(raw: unknown): WindowDays {
  const n = Number(raw);
  return (ALLOWED_WINDOWS as readonly number[]).includes(n) ? (n as WindowDays) : 30;
}

// ── dimensions ────────────────────────────────────────────────────────────────

interface ClassificationRow {
  competitorId: string;
  postTimestamp: Date | null;
  primaryHook: string | null;
  primaryAngle: string | null;
  hookArchetype: string | null;
  coreMarketingPromise: string | null;
  emotionalTrigger: string | null;
  positioningStyle: string | null;
  primaryGoal: string | null;
  ctaType: string | null;
  narrative: string | null;
  awarenessStage: string | null;
  offerType: string | null;
  contentFormatIntent: string | null;
}

interface DimensionSpec {
  dimension: string;
  label: string;
  /** Free-text dimensions have unbounded cardinality — flagged for honest confidence scoring. */
  freeText: boolean;
  getter: (r: ClassificationRow) => string | null;
}

/** All 12 classified semantic dimensions (brief §1 lists 11; hook archetype included as the enumerated hook dimension). */
export const DISTRIBUTION_DIMENSIONS: DimensionSpec[] = [
  { dimension: "hook_archetype",        label: "Hook archetype",     freeText: false, getter: (r) => r.hookArchetype },
  { dimension: "primary_hook",          label: "Primary hook",       freeText: true,  getter: (r) => r.primaryHook },
  { dimension: "primary_angle",         label: "Primary angle",      freeText: true,  getter: (r) => r.primaryAngle },
  { dimension: "core_promise",          label: "Core promise",       freeText: false, getter: (r) => r.coreMarketingPromise },
  { dimension: "emotional_trigger",     label: "Emotional trigger",  freeText: false, getter: (r) => r.emotionalTrigger },
  { dimension: "positioning_style",     label: "Positioning style",  freeText: false, getter: (r) => r.positioningStyle },
  { dimension: "narrative",             label: "Narrative",          freeText: false, getter: (r) => r.narrative },
  { dimension: "awareness_stage",       label: "Awareness stage",    freeText: false, getter: (r) => r.awarenessStage },
  { dimension: "offer_type",            label: "Offer type",         freeText: false, getter: (r) => r.offerType },
  { dimension: "cta_type",              label: "Call to action",     freeText: false, getter: (r) => r.ctaType },
  { dimension: "primary_goal",          label: "Post goal",          freeText: false, getter: (r) => r.primaryGoal },
  { dimension: "content_format_intent", label: "Content format",     freeText: false, getter: (r) => r.contentFormatIntent },
];

// ── output types (brief §7) ───────────────────────────────────────────────────

export interface DistributionEntry {
  value: string;
  count: number;
  share: number; // 0–100, rounded
}

export interface DistributionInsight {
  dimension: string;
  dimensionLabel: string;
  leader: string | null;
  leaderShare: number;               // %
  previousLeader: string | null;
  previousLeaderShare: number;       // % (share of the PREVIOUS leader in prev window)
  trend: "rising" | "falling" | "stable" | "new_leader" | "insufficient_history";
  trendDeltaPp: number;              // leader share now − leader share before
  distribution: DistributionEntry[]; // top 6, current window
  sampleSize: number;                // classified posts in current window (this dimension, known values)
  previousSampleSize: number;
  competitorCount: number;           // distinct competitors contributing (current window)
  confidence: "high" | "medium" | "low";
  windowDays: number;
  evidence: string[];
}

export interface PatternSignal {
  dimension: string;
  dimensionLabel: string;
  value: string;
  currentShare: number;   // %
  previousShare: number;  // %
  deltaPp: number;
  competitorCount: number; // competitors using this value in the relevant window
  postCount: number;
  evidence: string[];
}

export interface AdoptionPoint {
  bucketStart: string; // ISO date
  share: number;       // %
  posts: number;       // posts with a known value for the dimension in this bucket
}

export interface AdoptionSeries {
  dimension: string;
  dimensionLabel: string;
  value: string;
  direction: "emerging" | "declining";
  points: AdoptionPoint[];
  growthPp: number;        // last bucket share − first bucket share
  accelerationPp: number;  // second-half avg weekly delta − first-half avg weekly delta
}

export interface MarketDistributionSnapshot {
  campaignId: string;
  windowDays: number;
  generatedAt: string;
  currentWindow: { from: string; to: string };
  previousWindow: { from: string; to: string };
  totalPosts: number;          // classified posts in current window (any dimension)
  totalCompetitors: number;    // distinct competitors contributing in current window
  dataStatus: "ok" | "thin" | "insufficient";
  insights: DistributionInsight[];
  emerging: PatternSignal[];
  declining: PatternSignal[];
  adoption: AdoptionSeries[];
}

// ── in-process cache (bounded) ────────────────────────────────────────────────

const CACHE_MAX_ENTRIES = 300; // 100 campaigns × 3 windows
const cache = new Map<string, { at: number; snap: MarketDistributionSnapshot }>();

/** Insert with expiry pruning + LRU-style eviction so the map stays bounded. */
function cacheSet(key: string, snap: MarketDistributionSnapshot): void {
  const now = Date.now();
  for (const [k, v] of cache) {
    if (now - v.at >= CACHE_TTL_MS) cache.delete(k);
  }
  cache.delete(key); // re-insert at the end (most recent)
  cache.set(key, { at: now, snap });
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

function isKnown(v: string | null): v is string {
  if (!v) return false;
  const t = v.trim();
  return t.length > 0 && t !== "UNKNOWN" && t !== "NONE";
}

/** Free-text values are normalized (trim/collapse whitespace/lowercase) so "Question Hook" and "question hook" group together. */
function normalizeValue(v: string, freeText: boolean): string {
  const t = v.trim().replace(/\s+/g, " ");
  return freeText ? t.toLowerCase() : t;
}

interface ValueStats {
  count: number;
  competitors: Set<string>;
}

function buildStats(
  rows: ClassificationRow[],
  spec: DimensionSpec,
): { stats: Map<string, ValueStats>; total: number; competitors: Set<string> } {
  const stats = new Map<string, ValueStats>();
  const competitors = new Set<string>();
  let total = 0;
  for (const r of rows) {
    const raw = spec.getter(r);
    if (!isKnown(raw)) continue;
    const v = normalizeValue(raw, spec.freeText);
    total++;
    competitors.add(r.competitorId);
    let s = stats.get(v);
    if (!s) {
      s = { count: 0, competitors: new Set() };
      stats.set(v, s);
    }
    s.count++;
    s.competitors.add(r.competitorId);
  }
  return { stats, total, competitors };
}

function pct(count: number, total: number): number {
  return total > 0 ? Math.round((count / total) * 100) : 0;
}

function topEntries(stats: Map<string, ValueStats>, total: number, limit = 6): DistributionEntry[] {
  return Array.from(stats.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, limit)
    .map(([value, s]) => ({ value, count: s.count, share: pct(s.count, total) }));
}

// ── core computation ──────────────────────────────────────────────────────────

/**
 * Compute the full market distribution snapshot for a campaign.
 *
 * Windows: current = [now − windowDays, now], previous = [now − 2·windowDays, now − windowDays).
 * One DB query loads everything needed for both windows AND the weekly
 * adoption series (brief §9: avoid duplicate calculations).
 */
export async function computeMarketDistributionSnapshot(
  campaignId: string,
  windowDays: WindowDays = 30,
  opts: { skipCache?: boolean; now?: Date } = {},
): Promise<MarketDistributionSnapshot> {
  const cacheKey = `${campaignId}:${windowDays}`;
  if (!opts.skipCache) {
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.snap;
  }

  const now = opts.now ?? new Date();
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const currFrom = new Date(now.getTime() - windowMs);
  const prevFrom = new Date(now.getTime() - 2 * windowMs);

  // Single load: all v2 classifications for this campaign's competitors whose
  // post timestamps fall inside the double window. The join is index-backed
  // (classifications by competitor+version; posts by PK).
  //
  // NO catch here — a DB/load failure must propagate to the caller (route → 500),
  // never masquerade as "insufficient data" (no-silent-fallback doctrine).
  // Resolve the campaign's competitors first (small set) so the classification
  // query stays on the (competitor_id, classifier_version) index.
  const comps = await db
    .select({ id: ciCompetitors.id })
    .from(ciCompetitors)
    .where(eq(ciCompetitors.campaignId, campaignId));
  const compIds = comps.map((c) => c.id);
  if (compIds.length === 0) {
    // Legitimately-empty campaign (zero competitors) — honest empty snapshot.
    const empty = emptySnapshot(campaignId, windowDays, now, currFrom, prevFrom);
    cacheSet(cacheKey, empty);
    return empty;
  }

  const raw = await db
      .select({
        competitorId: competitorPostClassifications.competitorId,
        postTimestamp: ciCompetitorPosts.timestamp,
        confidenceScore: competitorPostClassifications.confidenceScore,
        primaryHook: competitorPostClassifications.primaryHook,
        primaryAngle: competitorPostClassifications.primaryAngle,
        hookArchetype: competitorPostClassifications.hookArchetype,
        coreMarketingPromise: competitorPostClassifications.coreMarketingPromise,
        emotionalTrigger: competitorPostClassifications.emotionalTrigger,
        positioningStyle: competitorPostClassifications.positioningStyle,
        primaryGoal: competitorPostClassifications.primaryGoal,
        ctaType: competitorPostClassifications.ctaType,
        narrative: competitorPostClassifications.narrative,
        awarenessStage: competitorPostClassifications.awarenessStage,
        offerType: competitorPostClassifications.offerType,
        contentFormatIntent: competitorPostClassifications.contentFormatIntent,
      })
      .from(competitorPostClassifications)
      .innerJoin(ciCompetitorPosts, eq(competitorPostClassifications.postId, ciCompetitorPosts.id))
      .where(
        and(
          inArray(competitorPostClassifications.competitorId, compIds),
          eq(competitorPostClassifications.classifierVersion, CLASSIFIER_VERSION),
          gte(ciCompetitorPosts.timestamp, prevFrom),
        ),
      );

  const rows: ClassificationRow[] = raw
    .filter((r) => {
      const conf = typeof r.confidenceScore === "number" ? r.confidenceScore : Number(r.confidenceScore ?? 0);
      if (conf < MIN_CONFIDENCE) return false;
      return r.postTimestamp != null && r.postTimestamp <= now;
    })
    .map(({ confidenceScore: _c, ...rest }) => rest);

  const currRows = rows.filter((r) => r.postTimestamp! >= currFrom);
  const prevRows = rows.filter((r) => r.postTimestamp! < currFrom);

  const totalCompetitors = new Set(currRows.map((r) => r.competitorId)).size;
  const dataStatus: MarketDistributionSnapshot["dataStatus"] =
    currRows.length < MIN_WINDOW_POSTS ? "insufficient" : currRows.length < THIN_WINDOW_POSTS ? "thin" : "ok";

  const insights: DistributionInsight[] = [];
  const emerging: PatternSignal[] = [];
  const declining: PatternSignal[] = [];
  const adoption: AdoptionSeries[] = [];

  for (const spec of DISTRIBUTION_DIMENSIONS) {
    const curr = buildStats(currRows, spec);
    const prev = buildStats(prevRows, spec);
    if (curr.total === 0 && prev.total === 0) continue;

    // ── §1/§5: distribution + dominant pattern ────────────────────────────────
    const entries = topEntries(curr.stats, curr.total);
    const leader = entries[0] ?? null;
    const prevEntries = topEntries(prev.stats, prev.total, 1);
    const prevLeader = prevEntries[0] ?? null;

    let trend: DistributionInsight["trend"];
    let trendDeltaPp = 0;
    if (prev.total < MIN_WINDOW_POSTS) {
      trend = "insufficient_history";
    } else if (!leader) {
      trend = "insufficient_history";
    } else {
      const leaderPrevShare = pct(prev.stats.get(leader.value)?.count ?? 0, prev.total);
      trendDeltaPp = leader.share - leaderPrevShare;
      if (prevLeader && prevLeader.value !== leader.value) trend = "new_leader";
      else if (trendDeltaPp >= LEADER_TREND_THRESHOLD_PP) trend = "rising";
      else if (trendDeltaPp <= -LEADER_TREND_THRESHOLD_PP) trend = "falling";
      else trend = "stable";
    }

    // Honest confidence: sample size + competitor breadth; free-text dimensions
    // additionally require a non-fragmented distribution (leader must actually
    // repeat) before rising above low.
    const fragmented = spec.freeText && (leader?.count ?? 0) < 3;
    const confidence: DistributionInsight["confidence"] =
      fragmented || curr.total < MIN_WINDOW_POSTS
        ? "low"
        : curr.total >= 30 && curr.competitors.size >= 4
          ? "high"
          : curr.total >= THIN_WINDOW_POSTS && curr.competitors.size >= 2
            ? "medium"
            : "low";

    const evidence: string[] = [];
    if (leader) {
      evidence.push(`"${leader.value}" leads with ${leader.share}% of ${curr.total} classified posts (${curr.competitors.size} competitors, last ${windowDays}d)`);
    }
    if (prevLeader && leader && prevLeader.value !== leader.value) {
      evidence.push(`previous leader was "${prevLeader.value}" (${prevLeader.share}% of ${prev.total} posts)`);
    } else if (leader && prev.total >= MIN_WINDOW_POSTS) {
      evidence.push(`leader share moved ${trendDeltaPp >= 0 ? "+" : ""}${trendDeltaPp}pp vs previous ${windowDays}d`);
    }
    if (fragmented) evidence.push(`free-text dimension is fragmented — no value repeats 3+ times`);

    insights.push({
      dimension: spec.dimension,
      dimensionLabel: spec.label,
      leader: leader?.value ?? null,
      leaderShare: leader?.share ?? 0,
      previousLeader: prevLeader?.value ?? null,
      previousLeaderShare: prevLeader?.share ?? 0,
      trend,
      trendDeltaPp,
      distribution: entries,
      sampleSize: curr.total,
      previousSampleSize: prev.total,
      competitorCount: curr.competitors.size,
      confidence,
      windowDays,
      evidence,
    });

    // ── §3/§4: emerging & declining patterns ─────────────────────────────────
    // Needs both windows to be meaningfully sized — trend claims from a thin
    // window are noise (brief §4: noise filtering).
    if (curr.total >= MIN_WINDOW_POSTS && prev.total >= MIN_WINDOW_POSTS && !spec.freeText) {
      const allValues = new Set([...curr.stats.keys(), ...prev.stats.keys()]);
      for (const value of allValues) {
        const c = curr.stats.get(value);
        const p = prev.stats.get(value);
        const currShare = pct(c?.count ?? 0, curr.total);
        const prevShare = pct(p?.count ?? 0, prev.total);
        const deltaPp = currShare - prevShare;

        if (
          deltaPp >= EMERGING_MIN_DELTA_PP &&
          currShare >= EMERGING_MIN_SHARE &&
          (c?.competitors.size ?? 0) >= EMERGING_MIN_COMPETITORS &&
          (c?.count ?? 0) >= EMERGING_MIN_POSTS
        ) {
          emerging.push({
            dimension: spec.dimension,
            dimensionLabel: spec.label,
            value,
            currentShare: currShare,
            previousShare: prevShare,
            deltaPp,
            competitorCount: c!.competitors.size,
            postCount: c!.count,
            evidence: [
              `${spec.label}: "${value}" grew ${prevShare}% → ${currShare}% (+${deltaPp}pp)`,
              `${c!.count} posts across ${c!.competitors.size} competitors in last ${windowDays}d`,
            ],
          });
          adoption.push(buildAdoptionSeries(rows, spec, value, "emerging", prevFrom, now));
        } else if (
          deltaPp <= -DECLINING_MIN_DELTA_PP &&
          prevShare >= DECLINING_MIN_PREV_SHARE &&
          (p?.count ?? 0) >= DECLINING_MIN_PREV_POSTS
        ) {
          declining.push({
            dimension: spec.dimension,
            dimensionLabel: spec.label,
            value,
            currentShare: currShare,
            previousShare: prevShare,
            deltaPp,
            competitorCount: p!.competitors.size,
            postCount: c?.count ?? 0,
            evidence: [
              `${spec.label}: "${value}" fell ${prevShare}% → ${currShare}% (${deltaPp}pp)`,
              `previously ${p!.count} posts across ${p!.competitors.size} competitors`,
            ],
          });
          adoption.push(buildAdoptionSeries(rows, spec, value, "declining", prevFrom, now));
        }
      }
    }
  }

  // Strongest movers first.
  emerging.sort((a, b) => b.deltaPp - a.deltaPp);
  declining.sort((a, b) => a.deltaPp - b.deltaPp);

  const snap: MarketDistributionSnapshot = {
    campaignId,
    windowDays,
    generatedAt: now.toISOString(),
    currentWindow: { from: currFrom.toISOString(), to: now.toISOString() },
    previousWindow: { from: prevFrom.toISOString(), to: currFrom.toISOString() },
    totalPosts: currRows.length,
    totalCompetitors,
    dataStatus,
    insights,
    emerging,
    declining,
    adoption,
  };

  cacheSet(cacheKey, snap);
  console.log(
    `${LOG_PREFIX} SNAPSHOT campaign=${campaignId} window=${windowDays}d posts=${currRows.length} prevPosts=${prevRows.length} competitors=${totalCompetitors} dims=${insights.length} emerging=${emerging.length} declining=${declining.length} status=${dataStatus}`,
  );
  return snap;
}

/** §2: weekly adoption buckets across the full double window for one (dimension, value). */
function buildAdoptionSeries(
  rows: ClassificationRow[],
  spec: DimensionSpec,
  value: string,
  direction: "emerging" | "declining",
  from: Date,
  to: Date,
): AdoptionSeries {
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const points: AdoptionPoint[] = [];
  for (let start = from.getTime(); start < to.getTime(); start += weekMs) {
    const end = Math.min(start + weekMs, to.getTime());
    let total = 0;
    let hits = 0;
    for (const r of rows) {
      const ts = r.postTimestamp?.getTime();
      if (ts == null || ts < start || ts >= end) continue;
      const raw = spec.getter(r);
      if (!isKnown(raw)) continue;
      total++;
      if (normalizeValue(raw, spec.freeText) === value) hits++;
    }
    points.push({
      bucketStart: new Date(start).toISOString(),
      share: pct(hits, total),
      posts: total,
    });
  }

  // Growth: last measurable bucket − first measurable bucket.
  const measurable = points.filter((p) => p.posts > 0);
  const growthPp = measurable.length >= 2 ? measurable[measurable.length - 1].share - measurable[0].share : 0;

  // Acceleration: avg weekly delta in the second half − avg weekly delta in the first half.
  let accelerationPp = 0;
  if (measurable.length >= 4) {
    const deltas: number[] = [];
    for (let i = 1; i < measurable.length; i++) deltas.push(measurable[i].share - measurable[i - 1].share);
    const half = Math.floor(deltas.length / 2);
    const firstAvg = deltas.slice(0, half).reduce((a, b) => a + b, 0) / Math.max(1, half);
    const secondAvg = deltas.slice(half).reduce((a, b) => a + b, 0) / Math.max(1, deltas.length - half);
    accelerationPp = Math.round((secondAvg - firstAvg) * 10) / 10;
  }

  return {
    dimension: spec.dimension,
    dimensionLabel: spec.label,
    value,
    direction,
    points,
    growthPp,
    accelerationPp,
  };
}

function emptySnapshot(
  campaignId: string,
  windowDays: number,
  now: Date,
  currFrom: Date,
  prevFrom: Date,
): MarketDistributionSnapshot {
  return {
    campaignId,
    windowDays,
    generatedAt: now.toISOString(),
    currentWindow: { from: currFrom.toISOString(), to: now.toISOString() },
    previousWindow: { from: prevFrom.toISOString(), to: currFrom.toISOString() },
    totalPosts: 0,
    totalCompetitors: 0,
    dataStatus: "insufficient",
    insights: [],
    emerging: [],
    declining: [],
    adoption: [],
  };
}

/** Test seam: clear the in-process cache (validation harnesses only). */
export function _clearDistributionCache(): void {
  cache.clear();
}
