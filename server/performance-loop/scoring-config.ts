/**
 * P-2 Phase 3/4 — Config-driven scoring thresholds + public metric registry.
 *
 * All thresholds live here so they are visible, versioned, and auditable.
 * DOCTRINE: thresholds must never be lowered to manufacture a result
 * (prompt Phase 3E). Any change to values here MUST bump the scorer version.
 */

import type { ContentScoreMaturity, OwnedSnapshotCheckpoint } from "@shared/schema";

export const CONTENT_SCORER_VERSION = "p2-content-scorer-v1";
export const BUSINESS_SCORER_VERSION = "p2-business-scorer-v1";
// v2: baseline aggregation changed from mean to MEDIAN (outlier-robust; a
// single viral post in the comparison pool must not flip honest cohorts to
// UNDERPERFORMING). No rows were ever persisted under v1 semantics.
export const BASELINE_VERSION = "self-baseline-v2";

/**
 * Public metric registry (Phase 3C). Only metrics whose numerator AND
 * denominator are honestly available on the public scrape surface
 * (likes / comments / views / followers_at_observation / observation age).
 * A missing denominator returns UNAVAILABLE — never a substitute value.
 *
 * `priority` = preference order when several metrics are available; the
 * scorer picks the metric available for the MOST cohort posts, ties broken
 * by priority.
 */
export interface PublicMetricDef {
  key: string;
  label: string;
  priority: number;
  /** Returns the metric value, or null when honestly unavailable. */
  compute: (snap: {
    likes: number | null;
    comments: number | null;
    views: number | null;
    followersAtObservation: number | null;
    observationAgeHours: number | null;
  }) => number | null;
}

export const PUBLIC_METRIC_REGISTRY: PublicMetricDef[] = [
  {
    key: "engagement_per_view",
    label: "Visible engagement per view (likes+comments / views)",
    priority: 1,
    compute: (s) =>
      s.views !== null && s.views > 0 && s.likes !== null && s.comments !== null
        ? (s.likes + s.comments) / s.views
        : null,
  },
  {
    key: "likes_per_view",
    label: "Likes per view",
    priority: 2,
    compute: (s) => (s.views !== null && s.views > 0 && s.likes !== null ? s.likes / s.views : null),
  },
  {
    key: "comments_per_view",
    label: "Comments per view",
    priority: 3,
    compute: (s) => (s.views !== null && s.views > 0 && s.comments !== null ? s.comments / s.views : null),
  },
  {
    key: "engagement_per_follower",
    label: "Visible engagement per follower (likes+comments / followers)",
    priority: 4,
    compute: (s) =>
      s.followersAtObservation !== null && s.followersAtObservation > 0 && s.likes !== null && s.comments !== null
        ? (s.likes + s.comments) / s.followersAtObservation
        : null,
  },
  {
    key: "likes_per_follower",
    label: "Likes per follower",
    priority: 5,
    compute: (s) =>
      s.followersAtObservation !== null && s.followersAtObservation > 0 && s.likes !== null
        ? s.likes / s.followersAtObservation
        : null,
  },
  {
    key: "comments_per_follower",
    label: "Comments per follower",
    priority: 6,
    compute: (s) =>
      s.followersAtObservation !== null && s.followersAtObservation > 0 && s.comments !== null
        ? s.comments / s.followersAtObservation
        : null,
  },
  {
    key: "engagement_velocity",
    label: "Visible engagement per hour since publish",
    priority: 7,
    compute: (s) =>
      s.observationAgeHours !== null && s.observationAgeHours > 0 && s.likes !== null && s.comments !== null
        ? (s.likes + s.comments) / s.observationAgeHours
        : null,
  },
];

/** Checkpoint band → cohort maturity state (Phase 3B). */
export const CHECKPOINT_TO_MATURITY: Record<OwnedSnapshotCheckpoint, ContentScoreMaturity> = {
  "7d": "MATURE_7D",
  "72h": "PROVISIONAL_72H",
  "24h": "EARLY_24H",
  late: "OBSERVED_LATE",
  discovery: "IMMATURE",
  unknown_age: "UNKNOWN",
};

/** Observation preference when a post has several banded snapshots. */
export const CHECKPOINT_PREFERENCE: OwnedSnapshotCheckpoint[] = [
  "7d",
  "72h",
  "24h",
  "late",
  "discovery",
  "unknown_age",
];

export const CONTENT_SCORING_THRESHOLDS = {
  /** Fewer comparable posts than this → TESTING (never a strong verdict). */
  minSampleSize: 3,
  /** Trailing self-baseline window (days, by postedAt). */
  baselineWindowDays: 90,
  /** Minimum baseline posts for a comparable self-baseline. */
  minBaselineSampleSize: 2,
  /** Relative delta needed for WINNING (e.g. +25% vs self-baseline). */
  winningRelativeDelta: 0.25,
  /** Relative delta needed for UNDERPERFORMING (e.g. −25%). */
  underperformingRelativeDelta: -0.25,
  /** Minimum fraction of cohort on the same side of baseline. */
  minConsistency: 0.6,
  /** Max share of cohort metric mass a single post may carry for WINNING. */
  maxOutlierConcentration: 0.6,
} as const;

export const BUSINESS_SCORING_THRESHOLDS = {
  /** Minimum PRIOR scored weeks before a verdict beyond UNKNOWN is allowed. */
  minPriorWeeks: 2,
  /** Trailing baseline width (weeks). */
  baselineWeeks: 4,
  /** Relative improvement in a downstream stage that counts as meaningful. */
  workingRelativeDelta: 0.2,
  /** Relative deterioration that counts as meaningful. */
  driftingRelativeDelta: -0.2,
  /** Number of deteriorating funnel stages required for DRIFTING. */
  driftingMinStages: 2,
  /**
   * Minimum number of computable stage deltas required to claim "holding
   * steady" (WORKING with no improving stage). Fewer → UNKNOWN — B1: no
   * verdict on indeterminate evidence.
   */
  minComputableStagesForSteady: 2,
} as const;
