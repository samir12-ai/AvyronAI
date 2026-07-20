/**
 * P-2 Phase 3 — Deterministic content scoring. The scoring truth is produced
 * by CODE — AI never calculates or replaces these verdicts.
 *
 * ARCHITECTURE INVARIANT: DB-read + DB-write only. Never triggers engines.
 *
 * Honest cohorts (Phase 3A): same account, same campaign, same platform,
 * comparable maturity band, compatible metric availability, time-bounded
 * self-baseline. Instagram and TikTok are never mixed.
 *
 * NULL-never-zero: a metric with a missing numerator or denominator is
 * UNAVAILABLE — it is excluded, never coerced.
 */

import { randomUUID } from "crypto";
import { db } from "../db";
import {
  ownedPosts,
  ownedPostSnapshots,
  ownedContentScores,
  CONTENT_SCORE_DIMENSIONS,
  type ContentScoreDimension,
  type ContentScoreMaturity,
  type ContentScoreVerdict,
  type OwnedPost,
  type OwnedPostSnapshot,
  type OwnedContentScore,
} from "@shared/schema";
import { and, eq, gte } from "drizzle-orm";
import {
  CONTENT_SCORER_VERSION,
  BASELINE_VERSION,
  PUBLIC_METRIC_REGISTRY,
  CHECKPOINT_TO_MATURITY,
  CHECKPOINT_PREFERENCE,
  CONTENT_SCORING_THRESHOLDS,
} from "./scoring-config";

const T = CONTENT_SCORING_THRESHOLDS;

/** Supported lineage states whose plan-derived dimensions may be scored. */
const SCORABLE_LINEAGE = new Set(["planned_direct", "planned_matched", "manual_matched"]);

interface ScoredObservation {
  post: OwnedPost;
  snapshot: OwnedPostSnapshot;
  maturity: ContentScoreMaturity;
}

export interface ContentScoreRunResult {
  scoreRunId: string;
  scoredAt: Date;
  platform: string;
  totalPostsConsidered: number;
  cohortMaturity: ContentScoreMaturity | null;
  rows: OwnedContentScore[];
  persistFailures: number;
}

/**
 * Pick ONE observation per post for this scoring run (Phase 3B): the most
 * mature public_scrape snapshot available, by CHECKPOINT_PREFERENCE.
 */
function pickObservation(snaps: OwnedPostSnapshot[]): OwnedPostSnapshot | null {
  for (const cp of CHECKPOINT_PREFERENCE) {
    const candidates = snaps
      .filter((s) => s.checkpoint === cp && s.metricSource === "public_scrape")
      .sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime());
    if (candidates.length > 0) return candidates[0];
  }
  return null;
}

function metricInput(s: OwnedPostSnapshot) {
  return {
    likes: s.likes,
    comments: s.comments,
    views: s.views,
    followersAtObservation: s.followersAtObservation,
    observationAgeHours: s.observationAgeHours,
  };
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Self-baseline aggregation is the MEDIAN, not the mean: a single viral post
 * elsewhere in the account must not inflate the baseline and turn every
 * normal cohort into UNDERPERFORMING (mirror of the outlier guard on the
 * measured side). Deterministic and order-independent.
 */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Run one deterministic scoring pass for a campaign+platform. Persists one
 * append-only row per (dimension, dimensionValue) and returns them.
 */
export async function runContentScoring(params: {
  accountId: string;
  campaignId: string;
  platform: string;
}): Promise<ContentScoreRunResult> {
  const { accountId, campaignId, platform } = params;
  const scoredAt = new Date();
  const scoreRunId = `csr_${scoredAt.getTime()}_${randomUUID().slice(0, 8)}`;
  const tag = `campaign=${campaignId} platform=${platform} run=${scoreRunId}`;

  // ── Load posts + observations ────────────────────────────────────────────
  const posts = await db
    .select()
    .from(ownedPosts)
    .where(
      and(
        eq(ownedPosts.accountId, accountId),
        eq(ownedPosts.campaignId, campaignId),
        eq(ownedPosts.platform, platform),
      ),
    );

  const result: ContentScoreRunResult = {
    scoreRunId,
    scoredAt,
    platform,
    totalPostsConsidered: posts.length,
    cohortMaturity: null,
    rows: [],
    persistFailures: 0,
  };
  if (posts.length === 0) {
    console.log(`[ContentScorer] NO_OWNED_POSTS ${tag}`);
    return result;
  }

  const snapshots = await db
    .select()
    .from(ownedPostSnapshots)
    .where(
      and(
        eq(ownedPostSnapshots.accountId, accountId),
        eq(ownedPostSnapshots.campaignId, campaignId),
      ),
    );
  const snapsByPost = new Map<string, OwnedPostSnapshot[]>();
  for (const s of snapshots) {
    const arr = snapsByPost.get(s.ownedPostId) ?? [];
    arr.push(s);
    snapsByPost.set(s.ownedPostId, arr);
  }

  // One observation per post; time-bound the baseline pool by postedAt.
  const baselineCutoff = new Date(scoredAt.getTime() - T.baselineWindowDays * 24 * 3600 * 1000);
  const observations: ScoredObservation[] = [];
  for (const post of posts) {
    const snap = pickObservation(snapsByPost.get(post.id) ?? []);
    if (!snap) continue;
    if (post.postedAt && post.postedAt.getTime() < baselineCutoff.getTime()) continue; // time-bounded
    observations.push({
      post,
      snapshot: snap,
      maturity: CHECKPOINT_TO_MATURITY[snap.checkpoint as keyof typeof CHECKPOINT_TO_MATURITY] ?? "UNKNOWN",
    });
  }
  if (observations.length === 0) {
    console.log(`[ContentScorer] NO_OBSERVATIONS ${tag} posts=${posts.length}`);
    return result;
  }

  // ── Honest cohort: dominant maturity band (Phase 3A/3B) ─────────────────
  // Comparisons must not mix a 24h observation with a 7d observation. We keep
  // the band holding the most posts (tie → the more mature band) and record
  // the exclusion as a confounder.
  const byMaturity = new Map<ContentScoreMaturity, ScoredObservation[]>();
  for (const o of observations) {
    const arr = byMaturity.get(o.maturity) ?? [];
    arr.push(o);
    byMaturity.set(o.maturity, arr);
  }
  const maturityOrder: ContentScoreMaturity[] = [
    "MATURE_7D", "PROVISIONAL_72H", "EARLY_24H", "OBSERVED_LATE", "IMMATURE", "UNKNOWN",
  ];
  let cohortMaturity: ContentScoreMaturity = maturityOrder[0];
  let best = -1;
  for (const m of maturityOrder) {
    const n = byMaturity.get(m)?.length ?? 0;
    if (n > best) {
      best = n;
      cohortMaturity = m;
    }
  }
  const cohort = byMaturity.get(cohortMaturity) ?? [];
  const maturityMixExcluded = observations.length - cohort.length;
  result.cohortMaturity = cohortMaturity;

  // ── Score each dimension value ───────────────────────────────────────────
  for (const dimension of CONTENT_SCORE_DIMENSIONS) {
    const field: keyof OwnedPost =
      dimension === "hook_style" ? "hookStyle" : dimension === "content_angle" ? "contentAngle" : "contentType";

    // Dimension values come ONLY from supported lineage (plan-derived).
    const values = new Map<string, ScoredObservation[]>();
    for (const o of cohort) {
      if (!SCORABLE_LINEAGE.has(o.post.lineageState)) continue;
      const v = (o.post[field] as string | null)?.trim();
      if (!v) continue;
      const arr = values.get(v) ?? [];
      arr.push(o);
      values.set(v, arr);
    }

    for (const [dimensionValue, dimObs] of Array.from(values.entries())) {
      const row = scoreDimensionValue({
        dimension,
        dimensionValue,
        dimObs,
        cohort,
        cohortMaturity,
        maturityMixExcluded,
        tag,
      });
      try {
        const inserted = await db
          .insert(ownedContentScores)
          .values({
            accountId,
            campaignId,
            platform,
            scoreRunId,
            scoredAt,
            ...row,
          })
          .returning();
        result.rows.push(inserted[0]);
      } catch (err: any) {
        result.persistFailures++;
        console.error(
          `[ContentScorer] PERFORMANCE_SCORE_PERSIST_FAILED ${tag} dimension=${dimension} value="${dimensionValue}" err=${err?.message ?? String(err)}`,
        );
      }
    }
  }

  console.log(
    `[ContentScorer] SCORE_RUN_COMPLETE ${tag} cohortMaturity=${cohortMaturity} cohort=${cohort.length}/${observations.length} rows=${result.rows.length} persistFailures=${result.persistFailures}`,
  );
  return result;
}

function scoreDimensionValue(args: {
  dimension: ContentScoreDimension;
  dimensionValue: string;
  dimObs: ScoredObservation[];
  cohort: ScoredObservation[];
  cohortMaturity: ContentScoreMaturity;
  maturityMixExcluded: number;
  tag: string;
}) {
  const { dimension, dimensionValue, dimObs, cohort, cohortMaturity, maturityMixExcluded, tag } = args;
  const confounders: string[] = [];
  if (maturityMixExcluded > 0) confounders.push(`maturity_mix_excluded:${maturityMixExcluded}`);

  // ── Primary metric: available for the MOST dimension posts, tie → priority.
  let primaryMetric: string | null = null;
  let bestCount = 0;
  for (const def of [...PUBLIC_METRIC_REGISTRY].sort((a, b) => a.priority - b.priority)) {
    const n = dimObs.filter((o) => def.compute(metricInput(o.snapshot)) !== null).length;
    if (n > bestCount) {
      bestCount = n;
      primaryMetric = def.key;
    }
  }
  const metricDef = PUBLIC_METRIC_REGISTRY.find((m) => m.key === primaryMetric) ?? null;

  const base = {
    dimension,
    dimensionValue,
    maturity: cohortMaturity,
    scorerVersion: CONTENT_SCORER_VERSION,
    baselineVersion: BASELINE_VERSION,
    baselineWindowDays: T.baselineWindowDays,
  };

  if (!metricDef) {
    console.log(
      `[ContentScorer] PERFORMANCE_METRIC_UNAVAILABLE ${tag} dimension=${dimension} value="${dimensionValue}" reason=no_metric_with_honest_denominator`,
    );
    confounders.push("no_usable_public_metric");
    return {
      ...base,
      sampleSize: dimObs.length,
      includedPostIds: JSON.stringify(dimObs.map((o) => o.post.id)),
      snapshotIds: JSON.stringify(dimObs.map((o) => o.snapshot.id)),
      primaryMetric: null,
      baselineValue: null,
      baselineSampleSize: null,
      measuredValue: null,
      absoluteDelta: null,
      relativeDelta: null,
      consistency: null,
      outlierConcentration: null,
      confounders: JSON.stringify(confounders),
      confidence: null,
      verdict: "UNKNOWN" as ContentScoreVerdict,
    };
  }

  // Posts lacking the chosen metric are excluded (compatible availability).
  const usable = dimObs.filter((o) => metricDef.compute(metricInput(o.snapshot)) !== null);
  const excludedForMetric = dimObs.length - usable.length;
  if (excludedForMetric > 0) confounders.push(`metric_unavailable_excluded:${excludedForMetric}`);

  const sampleSize = usable.length;
  const includedPostIds = JSON.stringify(usable.map((o) => o.post.id));
  const snapshotIds = JSON.stringify(usable.map((o) => o.snapshot.id));
  const metricValues = usable.map((o) => metricDef.compute(metricInput(o.snapshot)) as number);
  const measuredValue = metricValues.length > 0 ? mean(metricValues) : null;

  // Outlier concentration: top post's share of the summed metric mass.
  let outlierConcentration: number | null = null;
  const total = metricValues.reduce((a, b) => a + b, 0);
  if (metricValues.length > 0 && total > 0) {
    outlierConcentration = Math.max(...metricValues) / total;
  }

  // ── Self-baseline: comparable cohort posts NOT carrying this dimension
  // value, same maturity band, same metric availability (Phase 3D).
  const dimPostIds = new Set(dimObs.map((o) => o.post.id));
  const baselinePool = cohort.filter(
    (o) => !dimPostIds.has(o.post.id) && metricDef.compute(metricInput(o.snapshot)) !== null,
  );
  const baselineValues = baselinePool.map((o) => metricDef.compute(metricInput(o.snapshot)) as number);
  const baselineSampleSize = baselineValues.length;
  const baselineValue = baselineSampleSize >= T.minBaselineSampleSize ? median(baselineValues) : null;

  let absoluteDelta: number | null = null;
  let relativeDelta: number | null = null;
  let consistency: number | null = null;
  if (measuredValue !== null && baselineValue !== null) {
    absoluteDelta = measuredValue - baselineValue;
    relativeDelta = baselineValue !== 0 ? absoluteDelta / Math.abs(baselineValue) : null;
    const side = Math.sign(absoluteDelta);
    if (side !== 0) {
      consistency = metricValues.filter((v) => Math.sign(v - baselineValue) === side).length / metricValues.length;
    } else {
      consistency = 0;
    }
  }

  // ── Verdict (config-driven; thresholds never lowered) ───────────────────
  let verdict: ContentScoreVerdict;
  if (sampleSize === 0) {
    console.log(
      `[ContentScorer] PERFORMANCE_METRIC_UNAVAILABLE ${tag} dimension=${dimension} value="${dimensionValue}" metric=${metricDef.key} reason=no_post_with_metric`,
    );
    verdict = "UNKNOWN";
  } else if (sampleSize < T.minSampleSize) {
    console.log(
      `[ContentScorer] PERFORMANCE_EVIDENCE_INSUFFICIENT ${tag} dimension=${dimension} value="${dimensionValue}" sample=${sampleSize} min=${T.minSampleSize}`,
    );
    confounders.push("low_sample");
    verdict = "TESTING";
  } else if (baselineValue === null) {
    console.log(
      `[ContentScorer] PERFORMANCE_BASELINE_UNAVAILABLE ${tag} dimension=${dimension} value="${dimensionValue}" baselinePosts=${baselineSampleSize} min=${T.minBaselineSampleSize}`,
    );
    confounders.push("baseline_unavailable");
    verdict = "TESTING";
  } else if (relativeDelta === null || consistency === null) {
    verdict = "TESTING";
  } else if (
    relativeDelta >= T.winningRelativeDelta &&
    consistency >= T.minConsistency &&
    (outlierConcentration === null || outlierConcentration <= T.maxOutlierConcentration)
  ) {
    verdict = "WINNING";
  } else if (relativeDelta >= T.winningRelativeDelta) {
    // Signal exists but one viral post or inconsistent evidence drives it.
    if (outlierConcentration !== null && outlierConcentration > T.maxOutlierConcentration) {
      confounders.push("outlier_post");
    }
    if (consistency < T.minConsistency) confounders.push("inconsistent_evidence");
    verdict = "NEUTRAL";
  } else if (relativeDelta <= T.underperformingRelativeDelta && consistency >= T.minConsistency) {
    verdict = "UNDERPERFORMING";
  } else if (relativeDelta <= T.underperformingRelativeDelta) {
    confounders.push("inconsistent_evidence");
    verdict = "NEUTRAL";
  } else {
    verdict = "NEUTRAL";
  }

  // ── Deterministic confidence heuristic (never manufactured) ─────────────
  let confidence: number | null = null;
  if (sampleSize > 0 && measuredValue !== null) {
    const sampleFactor = Math.min(1, sampleSize / (T.minSampleSize * 2));
    const maturityFactor =
      cohortMaturity === "MATURE_7D" ? 1 :
      cohortMaturity === "PROVISIONAL_72H" ? 0.8 :
      cohortMaturity === "OBSERVED_LATE" ? 0.7 :
      cohortMaturity === "EARLY_24H" ? 0.6 :
      cohortMaturity === "IMMATURE" ? 0.4 : 0.2;
    const baselineFactor = baselineValue !== null ? 1 : 0.5;
    const consistencyFactor = consistency !== null ? 0.5 + consistency / 2 : 0.5;
    confidence = Number((sampleFactor * maturityFactor * baselineFactor * consistencyFactor).toFixed(3));
  }

  return {
    ...base,
    sampleSize,
    includedPostIds,
    snapshotIds,
    primaryMetric: metricDef.key,
    baselineValue,
    baselineSampleSize,
    measuredValue,
    absoluteDelta,
    relativeDelta,
    consistency,
    outlierConcentration,
    confounders: JSON.stringify(confounders),
    confidence,
    verdict,
  };
}
