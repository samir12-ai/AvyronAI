import type { CompetitorInput, CompetitorSignalResult, SignalData, PostData, CommentData, EngagementQuality } from "./types";
import { MI_THRESHOLDS, MI_COST_LIMITS } from "./constants";

function clamp(v: number, min = -1, max = 1): number {
  return Math.max(min, Math.min(max, v));
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function variance(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);
}

function slope(values: number[]): number {
  if (values.length < 2) return 0;
  const n = values.length;
  const xMean = (n - 1) / 2;
  const yMean = mean(values);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (values[i] - yMean);
    den += (i - xMean) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

function groupByWeek(posts: PostData[]): PostData[][] {
  if (posts.length === 0) return [];
  const sorted = [...posts].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const weeks: PostData[][] = [];
  let currentWeek: PostData[] = [];
  let weekStart = new Date(sorted[0].timestamp).getTime();
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

  for (const post of sorted) {
    const t = new Date(post.timestamp).getTime();
    if (t - weekStart >= WEEK_MS) {
      if (currentWeek.length > 0) weeks.push(currentWeek);
      currentWeek = [post];
      weekStart = t;
    } else {
      currentWeek.push(post);
    }
  }
  if (currentWeek.length > 0) weeks.push(currentWeek);
  return weeks;
}

function computePostingFrequencyTrend(posts: PostData[]): number {
  const weeks = groupByWeek(posts);
  if (weeks.length < 2) return 0;
  const counts = weeks.map(w => w.length);
  return clamp(slope(counts) / Math.max(1, mean(counts)));
}

function computeEngagementVolatility(posts: PostData[]): number {
  if (posts.length < 3) return 0;
  const engagements = posts.map(p => (p.likes || 0) + (p.comments || 0));
  const v = variance(engagements);
  const m = mean(engagements);
  if (m === 0) return 0;
  const cv = Math.sqrt(v) / m;
  return clamp(cv, 0, 1);
}

function computeCTAIntensityShift(posts: PostData[]): number {
  if (posts.length < 4) return 0;
  const sorted = [...posts].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const mid = Math.floor(sorted.length / 2);
  const firstHalf = sorted.slice(0, mid);
  const secondHalf = sorted.slice(mid);
  const ctaRateFirst = firstHalf.filter(p => p.hasCTA).length / firstHalf.length;
  const ctaRateSecond = secondHalf.filter(p => p.hasCTA).length / secondHalf.length;
  return clamp(ctaRateSecond - ctaRateFirst);
}

function computeOfferLanguageChange(posts: PostData[]): number {
  if (posts.length < 4) return 0;
  const sorted = [...posts].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const mid = Math.floor(sorted.length / 2);
  const firstHalf = sorted.slice(0, mid);
  const secondHalf = sorted.slice(mid);
  const offerRateFirst = firstHalf.filter(p => p.hasOffer).length / firstHalf.length;
  const offerRateSecond = secondHalf.filter(p => p.hasOffer).length / secondHalf.length;
  return clamp(offerRateSecond - offerRateFirst);
}

function computeHashtagDriftScore(posts: PostData[]): number {
  if (posts.length < 4) return 0;
  const sorted = [...posts].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const mid = Math.floor(sorted.length / 2);
  const firstTags = new Set(sorted.slice(0, mid).flatMap(p => p.hashtags || []));
  const secondTags = new Set(sorted.slice(mid).flatMap(p => p.hashtags || []));
  if (firstTags.size === 0 && secondTags.size === 0) return 0;
  const union = new Set([...firstTags, ...secondTags]);
  const intersection = [...firstTags].filter(t => secondTags.has(t));
  if (union.size === 0) return 0;
  const jaccardSimilarity = intersection.length / union.size;
  return clamp(1 - jaccardSimilarity, 0, 1);
}

function computeBioModificationFrequency(competitor: CompetitorInput): number {
  if (competitor.messagingTone && competitor.messagingTone !== "unknown") return 0.3;
  return 0;
}

function computeSentimentDrift(posts: PostData[], comments?: { sentiment?: number }[]): number {
  if (!comments || comments.length < 10) return 0;
  const sorted = [...comments].filter(c => c.sentiment != null);
  if (sorted.length < 4) return 0;
  const mid = Math.floor(sorted.length / 2);
  const firstHalfSentiment = mean(sorted.slice(0, mid).map(c => c.sentiment!));
  const secondHalfSentiment = mean(sorted.slice(mid).map(c => c.sentiment!));
  return clamp(secondHalfSentiment - firstHalfSentiment);
}

function computeReviewVelocityChange(competitor: CompetitorInput): number {
  return 0;
}

function computeContentExperimentRate(posts: PostData[]): number {
  if (posts.length < 4) return 0;
  const types = new Set(posts.map(p => p.mediaType));
  const sorted = [...posts].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const recentQuarter = sorted.slice(Math.floor(sorted.length * 0.75));
  const recentTypes = new Set(recentQuarter.map(p => p.mediaType));
  const earlyQuarter = sorted.slice(0, Math.floor(sorted.length * 0.25));
  const earlyTypes = new Set(earlyQuarter.map(p => p.mediaType));
  const newFormats = [...recentTypes].filter(t => !earlyTypes.has(t));
  return clamp(newFormats.length / Math.max(1, types.size), 0, 1);
}

const HIGH_INTENT_PATTERNS = [
  /\?/,
  /how\s+to/i,
  /where\s+can\s+i/i,
  /does\s+this\s+work/i,
  /can\s+you\s+help/i,
  /help\s+me/i,
  /i\s+need/i,
  /what\s+is/i,
  /which\s+one/i,
  /how\s+much/i,
  /how\s+long/i,
  /is\s+this/i,
  /can\s+i/i,
  /should\s+i/i,
  /any\s+tips/i,
  /recommend/i,
  /confused/i,
  /don'?t\s+understand/i,
  /struggling/i,
  /doesn'?t\s+work/i,
  /not\s+working/i,
  /vs\.?\s/i,
  /compared\s+to/i,
  /difference\s+between/i,
  /alternative/i,
  /better\s+than/i,
];

const LOW_VALUE_PATTERNS = [
  /^[\p{Emoji}\s]+$/u,
  /^(nice|great|love\s+this|amazing|awesome|cool|wow|beautiful|perfect|fire|lit|dope|sick|yass?|yes+|yep|yeah)\s*[!.]*$/i,
  /^[\u{1F525}\u{1F44D}\u{2764}\u{FE0F}\u{1F60D}\u{1F64F}\u{1F44F}\u{1F4AF}\u{2728}\u{1F389}\u{1F49C}\u{1F499}\u{1F49A}\u{1F497}\u{1F496}\u{2665}]+$/u,
  /^(lol|lmao|haha+|omg)\s*[!.]*$/i,
  /^@\w+\s*$/,
  /^[.!]+$/,
];

export function classifyEngagementQuality(comments: CommentData[]): EngagementQuality {
  let highIntentCount = 0;
  let lowValueCount = 0;

  for (const comment of comments) {
    const text = (comment.text || "").trim();
    if (!text) continue;

    const isHighIntent = HIGH_INTENT_PATTERNS.some(p => p.test(text));
    const isLowValue = LOW_VALUE_PATTERNS.some(p => p.test(text));

    if (isHighIntent) highIntentCount++;
    if (isLowValue) lowValueCount++;
  }

  const total = highIntentCount + lowValueCount;
  const engagementQualityRatio = total > 0 ? highIntentCount / total : 0;

  return { highIntentCount, lowValueCount, engagementQualityRatio };
}

export function detectAudienceIntentSignals(comments: CommentData[]): string[] {
  const signals: string[] = [];
  const texts = comments.map(c => (c.text || "").toLowerCase());
  if (texts.length === 0) return signals;

  const confusionPatterns = [/confused/i, /don'?t\s+understand/i, /what\s+does/i, /explain/i, /unclear/i];
  const confusionCount = texts.filter(t => confusionPatterns.some(p => p.test(t))).length;
  if (confusionCount >= 2) signals.push("audience_confusion");

  const beginnerPatterns = [/beginner/i, /newbie/i, /just\s+started/i, /new\s+to/i, /how\s+do\s+i\s+start/i, /first\s+time/i];
  const beginnerCount = texts.filter(t => beginnerPatterns.some(p => p.test(t))).length;
  if (beginnerCount >= 2) signals.push("beginner_questions");

  const pricePatterns = [/how\s+much/i, /price/i, /cost/i, /afford/i, /expensive/i, /cheap/i, /budget/i, /worth\s+it/i, /free/i];
  const priceCount = texts.filter(t => pricePatterns.some(p => p.test(t))).length;
  if (priceCount >= 2) signals.push("price_sensitivity");

  const comparisonPatterns = [/vs\.?\s/i, /compared\s+to/i, /difference\s+between/i, /better\s+than/i, /alternative/i, /which\s+one/i, /or\s+should\s+i/i];
  const comparisonCount = texts.filter(t => comparisonPatterns.some(p => p.test(t))).length;
  if (comparisonCount >= 2) signals.push("method_comparison");

  const helpPatterns = [/help\s+me/i, /can\s+you\s+help/i, /i\s+need\s+help/i, /please\s+help/i, /struggling/i, /stuck/i];
  const helpCount = texts.filter(t => helpPatterns.some(p => p.test(t))).length;
  if (helpCount >= 2) signals.push("help_requests");

  const resultPatterns = [/does\s+(this|it)\s+work/i, /results/i, /before\s+and\s+after/i, /did\s+it\s+work/i, /how\s+long.*results/i, /transformation/i];
  const resultCount = texts.filter(t => resultPatterns.some(p => p.test(t))).length;
  if (resultCount >= 2) signals.push("results_seeking");

  const trustPatterns = [/scam/i, /legit/i, /trust/i, /real/i, /fake/i, /honest/i, /proof/i, /testimonial/i];
  const trustCount = texts.filter(t => trustPatterns.some(p => p.test(t))).length;
  if (trustCount >= 2) signals.push("trust_concerns");

  return signals;
}

export function computeCompetitorSignals(competitor: CompetitorInput): CompetitorSignalResult {
  const posts = (competitor.posts || []).slice(0, MI_COST_LIMITS.MAX_POSTS_PER_COMPETITOR);
  const comments = (competitor.comments || []).slice(0, MI_COST_LIMITS.MAX_COMMENTS_PER_COMPETITOR);

  const signals: SignalData = {
    postingFrequencyTrend: computePostingFrequencyTrend(posts),
    engagementVolatility: computeEngagementVolatility(posts),
    ctaIntensityShift: computeCTAIntensityShift(posts),
    offerLanguageChange: computeOfferLanguageChange(posts),
    hashtagDriftScore: computeHashtagDriftScore(posts),
    bioModificationFrequency: computeBioModificationFrequency(competitor),
    sentimentDrift: computeSentimentDrift(posts, comments),
    reviewVelocityChange: computeReviewVelocityChange(competitor),
    contentExperimentRate: computeContentExperimentRate(posts),
  };

  const missingFields: string[] = [];
  if (posts.length < MI_THRESHOLDS.MIN_POSTS_PER_COMPETITOR) missingFields.push(`posts (have ${posts.length}, need ${MI_THRESHOLDS.MIN_POSTS_PER_COMPETITOR})`);
  if (comments.length < MI_THRESHOLDS.MIN_COMMENTS_SAMPLE) missingFields.push(`comments (have ${comments.length}, need ${MI_THRESHOLDS.MIN_COMMENTS_SAMPLE})`);
  if (!competitor.postingFrequency && posts.length < MI_THRESHOLDS.MIN_ENGAGEMENT_POSTS) missingFields.push("postingFrequency");
  if (!competitor.contentTypeRatio) missingFields.push("contentTypeRatio");
  if (!competitor.engagementRatio && posts.length < MI_THRESHOLDS.MIN_ENGAGEMENT_POSTS) missingFields.push("engagementRatio");
  if (!competitor.ctaPatterns) missingFields.push("ctaPatterns");
  if (!competitor.profileLink) missingFields.push("profileLink (bio/CTA detection)");

  const totalExpectedFields = 9;
  const availableFields = totalExpectedFields - [
    posts.length < MI_THRESHOLDS.MIN_POSTS_PER_COMPETITOR,
    comments.length < MI_THRESHOLDS.MIN_COMMENTS_SAMPLE,
    !competitor.engagementRatio && posts.length < MI_THRESHOLDS.MIN_ENGAGEMENT_POSTS,
    !competitor.ctaPatterns,
    !competitor.profileLink,
  ].filter(Boolean).length;

  const signalCoverageScore = Math.round((availableFields / totalExpectedFields) * 100) / 100;
  const sourceReliabilityScore = 0.75;

  const sampleSize = posts.length + comments.length;
  const now = Date.now();
  const postTimestamps = posts.map(p => new Date(p.timestamp).getTime()).filter(t => !isNaN(t));
  const oldestPost = postTimestamps.length > 0 ? Math.min(...postTimestamps) : now;
  const timeWindowDays = Math.max(1, Math.round((now - oldestPost) / (1000 * 60 * 60 * 24)));

  const signalValues = Object.values(signals);
  const varianceScore = Math.round(variance(signalValues) * 1000) / 1000;

  return {
    competitorId: competitor.id,
    competitorName: competitor.name,
    signals,
    signalCoverageScore,
    sourceReliabilityScore,
    sampleSize,
    timeWindowDays,
    varianceScore,
    dominantSourceRatio: 0,
    missingFields,
  };
}

export function computeAllSignals(competitors: CompetitorInput[]): CompetitorSignalResult[] {
  const capped = competitors.slice(0, MI_COST_LIMITS.MAX_COMPETITORS);
  const results = capped.map(computeCompetitorSignals);

  if (results.length > 0) {
    const totalSamples = results.reduce((s, r) => s + r.sampleSize, 0);
    for (const r of results) {
      r.dominantSourceRatio = totalSamples > 0 ? Math.round((r.sampleSize / totalSamples) * 100) / 100 : 0;
    }
  }

  return results;
}

export function aggregateMissingFlags(signalResults: CompetitorSignalResult[]): string[] {
  const flags: Set<string> = new Set();
  for (const r of signalResults) {
    for (const f of r.missingFields) {
      flags.add(`${r.competitorName}: ${f}`);
    }
  }
  if (signalResults.length < MI_THRESHOLDS.MIN_COMPETITORS) {
    flags.add(`Insufficient competitors (have ${signalResults.length}, need ${MI_THRESHOLDS.MIN_COMPETITORS})`);
  }
  const fullyQualified = signalResults.filter(r => r.missingFields.length === 0).length;
  if (fullyQualified < MI_THRESHOLDS.MIN_FULL_THRESHOLD_COMPETITORS) {
    flags.add(`Insufficient fully qualified competitors (have ${fullyQualified}, need ${MI_THRESHOLDS.MIN_FULL_THRESHOLD_COMPETITORS})`);
  }
  return Array.from(flags);
}
