export type TikTokPerformanceTier = "HIGH_PERFORMING" | "MID_PERFORMING" | "LOW_PERFORMING";

export interface TikTokPostQualification {
  postId: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  engagementRate: number;
  relativeScore: number;
  tier: TikTokPerformanceTier;
  baselineViews: number;
  baselineEngagement: number;
}

export interface TikTokCreatorBaseline {
  avgViews: number;
  avgLikes: number;
  avgComments: number;
  avgShares: number;
  avgEngagementRate: number;
  postCount: number;
}

export interface BaselineReliability {
  score: number;
  band: "RELIABLE" | "MODERATE" | "WEAK" | "INSUFFICIENT";
  lowDataPenalty: number;
  qualificationNotes: string[];
}

export interface TikTokQualificationResult {
  baseline: TikTokCreatorBaseline;
  baselineReliability: BaselineReliability;
  qualifications: TikTokPostQualification[];
  highPerformingCount: number;
  midPerformingCount: number;
  lowPerformingCount: number;
  totalPosts: number;
  filteredPostIds: string[];
  qualificationTimestamp: string;
}

interface RawTikTokPost {
  id?: string;
  postId?: string;
  caption?: string;
  hookText?: string | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  views?: number | null;
  timestamp?: string | Date | null;
}

const HIGH_THRESHOLD = 1.5;
const LOW_THRESHOLD = 0.6;

const VIEW_WEIGHT = 0.35;
const ENGAGEMENT_WEIGHT = 0.35;
const SHARE_WEIGHT = 0.15;
const RECENCY_WEIGHT = 0.15;

const MIN_POSTS_FOR_RELIABLE_BASELINE = 10;
const MIN_POSTS_FOR_MODERATE_BASELINE = 5;
const MIN_POSTS_FOR_ANY_BASELINE = 3;
const MIN_AVG_VIEWS_FOR_ENGAGEMENT = 50;
const MIN_AVG_ENGAGEMENT_RATE = 0.005;

export function computeCreatorBaseline(posts: RawTikTokPost[]): TikTokCreatorBaseline {
  if (posts.length === 0) {
    return { avgViews: 0, avgLikes: 0, avgComments: 0, avgShares: 0, avgEngagementRate: 0, postCount: 0 };
  }

  const totalViews = posts.reduce((s, p) => s + (p.views || 0), 0);
  const totalLikes = posts.reduce((s, p) => s + (p.likes || 0), 0);
  const totalComments = posts.reduce((s, p) => s + (p.comments || 0), 0);
  const totalShares = posts.reduce((s, p) => s + (p.shares || 0), 0);
  const n = posts.length;

  const avgViews = totalViews / n;
  const avgLikes = totalLikes / n;
  const avgComments = totalComments / n;
  const avgShares = totalShares / n;
  const avgEngagementRate = avgViews > 0 ? (avgLikes + avgComments + avgShares) / avgViews : 0;

  return { avgViews, avgLikes, avgComments, avgShares, avgEngagementRate, postCount: n };
}

export function computeBaselineReliability(baseline: TikTokCreatorBaseline): BaselineReliability {
  const notes: string[] = [];
  let score = 0;
  let penalty = 0;

  if (baseline.postCount >= MIN_POSTS_FOR_RELIABLE_BASELINE) {
    score += 0.4;
  } else if (baseline.postCount >= MIN_POSTS_FOR_MODERATE_BASELINE) {
    score += 0.25;
    notes.push(`Post count (${baseline.postCount}) below reliable threshold (${MIN_POSTS_FOR_RELIABLE_BASELINE})`);
  } else if (baseline.postCount >= MIN_POSTS_FOR_ANY_BASELINE) {
    score += 0.1;
    penalty += 0.3;
    notes.push(`Low post count (${baseline.postCount}) — baseline is weak, qualification results may be unreliable`);
  } else {
    penalty += 0.6;
    notes.push(`Insufficient posts (${baseline.postCount}) for meaningful baseline — TikTok signals heavily downgraded`);
  }

  if (baseline.avgViews >= MIN_AVG_VIEWS_FOR_ENGAGEMENT * 10) {
    score += 0.3;
  } else if (baseline.avgViews >= MIN_AVG_VIEWS_FOR_ENGAGEMENT) {
    score += 0.15;
    notes.push(`Low average views (${Math.round(baseline.avgViews)}) — engagement metrics may not be representative`);
  } else {
    penalty += 0.2;
    notes.push(`Very low average views (${Math.round(baseline.avgViews)}) — insufficient engagement data for meaningful qualification`);
  }

  if (baseline.avgEngagementRate >= MIN_AVG_ENGAGEMENT_RATE * 4) {
    score += 0.3;
  } else if (baseline.avgEngagementRate >= MIN_AVG_ENGAGEMENT_RATE) {
    score += 0.15;
  } else {
    penalty += 0.15;
    notes.push(`Below-minimum engagement rate (${(baseline.avgEngagementRate * 100).toFixed(3)}%) — qualification tiers may be inaccurate`);
  }

  score = Math.max(0, Math.min(1, score - penalty));

  let band: BaselineReliability["band"];
  if (score >= 0.7) band = "RELIABLE";
  else if (score >= 0.45) band = "MODERATE";
  else if (score >= 0.2) band = "WEAK";
  else band = "INSUFFICIENT";

  return {
    score: Math.round(score * 1000) / 1000,
    band,
    lowDataPenalty: Math.round(penalty * 1000) / 1000,
    qualificationNotes: notes,
  };
}

function computeRecencyScore(timestamp: string | Date | null | undefined, newestTimestamp: number): number {
  if (!timestamp) return 0.5;
  const age = newestTimestamp - new Date(timestamp).getTime();
  const dayAge = age / (1000 * 60 * 60 * 24);
  if (dayAge <= 7) return 1.0;
  if (dayAge <= 14) return 0.85;
  if (dayAge <= 30) return 0.65;
  if (dayAge <= 60) return 0.4;
  return 0.2;
}

export function qualifyTikTokPosts(posts: RawTikTokPost[]): TikTokQualificationResult {
  const baseline = computeCreatorBaseline(posts);
  const baselineReliability = computeBaselineReliability(baseline);

  if (posts.length === 0) {
    return {
      baseline,
      baselineReliability,
      qualifications: [],
      highPerformingCount: 0,
      midPerformingCount: 0,
      lowPerformingCount: 0,
      totalPosts: 0,
      filteredPostIds: [],
      qualificationTimestamp: new Date().toISOString(),
    };
  }

  const newestTimestamp = Math.max(
    ...posts.map(p => p.timestamp ? new Date(p.timestamp).getTime() : 0),
    Date.now()
  );

  const qualifications: TikTokPostQualification[] = posts.map(post => {
    const views = post.views || 0;
    const likes = post.likes || 0;
    const comments = post.comments || 0;
    const shares = post.shares || 0;
    const totalEngagement = likes + comments + shares;
    const engagementRate = views > 0 ? totalEngagement / views : 0;

    const viewRatio = baseline.avgViews > 0 ? views / baseline.avgViews : (views > 0 ? 0.5 : 0);
    const engagementRatio = baseline.avgEngagementRate > 0
      ? engagementRate / baseline.avgEngagementRate : (engagementRate > 0 ? 0.5 : 0);
    const shareRatio = baseline.avgShares > 0 ? (shares / baseline.avgShares) : (shares > 0 ? 0.5 : 0);
    const recency = computeRecencyScore(post.timestamp, newestTimestamp);

    const compositeScore =
      Math.min(viewRatio, 3) * VIEW_WEIGHT +
      Math.min(engagementRatio, 3) * ENGAGEMENT_WEIGHT +
      Math.min(shareRatio, 3) * SHARE_WEIGHT +
      recency * RECENCY_WEIGHT;

    const relativeScore = Math.min(Math.max(compositeScore / 2, 0), 1);

    let tier: TikTokPerformanceTier;
    if (compositeScore >= HIGH_THRESHOLD) {
      tier = "HIGH_PERFORMING";
    } else if (compositeScore >= LOW_THRESHOLD) {
      tier = "MID_PERFORMING";
    } else {
      tier = "LOW_PERFORMING";
    }

    return {
      postId: post.postId || post.id || "",
      views,
      likes,
      comments,
      shares,
      engagementRate: Math.round(engagementRate * 10000) / 10000,
      relativeScore: Math.round(relativeScore * 1000) / 1000,
      tier,
      baselineViews: Math.round(baseline.avgViews),
      baselineEngagement: Math.round(baseline.avgEngagementRate * 10000) / 10000,
    };
  });

  const highPerformingCount = qualifications.filter(q => q.tier === "HIGH_PERFORMING").length;
  const midPerformingCount = qualifications.filter(q => q.tier === "MID_PERFORMING").length;
  const lowPerformingCount = qualifications.filter(q => q.tier === "LOW_PERFORMING").length;
  const filteredPostIds = qualifications.filter(q => q.tier === "LOW_PERFORMING").map(q => q.postId);

  console.log(
    `[TikTokQualification] total=${posts.length} | HIGH=${highPerformingCount} | MID=${midPerformingCount} | LOW=${lowPerformingCount} | avgViews=${Math.round(baseline.avgViews)} | avgER=${(baseline.avgEngagementRate * 100).toFixed(2)}% | baselineReliability=${baselineReliability.band}(${baselineReliability.score}) | penalty=${baselineReliability.lowDataPenalty}`
  );

  return {
    baseline,
    baselineReliability,
    qualifications,
    highPerformingCount,
    midPerformingCount,
    lowPerformingCount,
    totalPosts: posts.length,
    filteredPostIds,
    qualificationTimestamp: new Date().toISOString(),
  };
}

export function filterQualifiedPosts<T extends { postId?: string; id?: string }>(
  posts: T[],
  qualifications: TikTokPostQualification[],
  includeMid: boolean = true,
): T[] {
  const qualMap = new Map(qualifications.map(q => [q.postId, q]));

  return posts.filter(post => {
    const pid = post.postId || post.id || "";
    const qual = qualMap.get(pid);
    if (!qual) return true;
    if (qual.tier === "HIGH_PERFORMING") return true;
    if (qual.tier === "MID_PERFORMING" && includeMid) return true;
    return false;
  });
}

export function getTikTokContributionMultiplier(reliability: BaselineReliability): number {
  switch (reliability.band) {
    case "RELIABLE": return 1.0;
    case "MODERATE": return 0.75;
    case "WEAK": return 0.4;
    case "INSUFFICIENT": return 0.15;
  }
}
