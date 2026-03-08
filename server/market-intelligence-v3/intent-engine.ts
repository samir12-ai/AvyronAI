import type { CompetitorSignalResult, IntentCategory, IntentResult, IntentStatus, SignalData } from "./types";
import { MI_INTENT_WEIGHTS, MI_CONFIDENCE, MI_THRESHOLDS } from "./constants";

function computeIntentScores(signals: SignalData): Record<IntentCategory, number> {
  const categories = Object.keys(MI_INTENT_WEIGHTS) as IntentCategory[];
  const scores: Record<string, number> = {};

  for (const category of categories) {
    const weights = MI_INTENT_WEIGHTS[category];
    let score = 0;
    for (const [key, weight] of Object.entries(weights)) {
      const signalValue = signals[key as keyof SignalData] || 0;
      score += signalValue * weight;
    }
    scores[category] = Math.round(Math.max(0, Math.min(1, (score + 1) / 2)) * 1000) / 1000;
  }

  return scores as Record<IntentCategory, number>;
}

function selectDominantIntent(scores: Record<IntentCategory, number>): IntentCategory {
  let maxScore = -Infinity;
  let dominant: IntentCategory = "STABLE_DOMINANT";
  for (const [category, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      dominant = category as IntentCategory;
    }
  }
  return dominant;
}

export function classifyCompetitorIntent(signalResult: CompetitorSignalResult): IntentResult {
  const scores = computeIntentScores(signalResult.signals);
  let intentCategory = selectDominantIntent(scores);
  let degraded = false;
  let degradeReason: string | undefined;

  if (signalResult.signalCoverageScore < MI_CONFIDENCE.UNSTABLE_THRESHOLD) {
    degraded = true;
    degradeReason = `Signal coverage too low (${signalResult.signalCoverageScore}), intent classification degraded to UNSTABLE proxy`;
  }

  if (signalResult.sampleSize < 10) {
    degraded = true;
    degradeReason = `Insufficient sample size (${signalResult.sampleSize}), cannot reliably classify intent`;
  }

  const maxScore = Math.max(...Object.values(scores));
  const sortedScores = Object.values(scores).sort((a, b) => b - a);
  const secondMax = sortedScores[1] || 0;
  if (maxScore - secondMax < 0.05) {
    degraded = true;
    degradeReason = `Ambiguous intent: top scores too close (${maxScore.toFixed(3)} vs ${secondMax.toFixed(3)})`;
  }

  const signalConsistencyFactor = Math.min(1, signalResult.signalCoverageScore * (1 - signalResult.varianceScore));
  const rawIntentConfidence = (maxScore - secondMax) + signalConsistencyFactor * 0.5;
  const intentConfidence = Math.round(Math.max(0, Math.min(1, rawIntentConfidence)) * 1000) / 1000;

  let intentConfidenceBand: "STRONG" | "MODERATE" | "UNCERTAIN" | "DEGRADED";
  if (intentConfidence > 0.75) intentConfidenceBand = "STRONG";
  else if (intentConfidence >= 0.55) intentConfidenceBand = "MODERATE";
  else if (intentConfidence >= 0.40) intentConfidenceBand = "UNCERTAIN";
  else intentConfidenceBand = "DEGRADED";

  let intentStatus: IntentStatus = "FINAL";
  let intentStatusReason: string | undefined;

  const postCount = signalResult.sampleSize - (signalResult.commentCount ?? 0);
  const commentCount = signalResult.commentCount ?? 0;

  const provisionalReasons: string[] = [];
  if (postCount < MI_THRESHOLDS.MIN_POSTS_PER_COMPETITOR) {
    provisionalReasons.push(`posts < ${MI_THRESHOLDS.MIN_POSTS_PER_COMPETITOR} (have ${postCount})`);
  }
  if (commentCount < MI_THRESHOLDS.MIN_COMMENTS_SAMPLE) {
    provisionalReasons.push(`comments < ${MI_THRESHOLDS.MIN_COMMENTS_SAMPLE} (have ${commentCount})`);
  }

  if (provisionalReasons.length > 0) {
    intentStatus = "PROVISIONAL";
    intentStatusReason = provisionalReasons.join("; ");
    console.log(`[IntentEngine] PROVISIONAL intent for ${signalResult.competitorName}: ${intentStatusReason}`);
  }

  return {
    competitorId: signalResult.competitorId,
    competitorName: signalResult.competitorName,
    intentCategory,
    intentScore: scores[intentCategory],
    scores,
    degraded,
    degradeReason,
    topIntentScore: maxScore,
    intentConfidence,
    intentConfidenceBand,
    intentStatus,
    intentStatusReason,
  };
}

export function classifyAllIntents(signalResults: CompetitorSignalResult[]): IntentResult[] {
  return signalResults.map(classifyCompetitorIntent);
}

export function computeDominantMarketIntent(intents: IntentResult[], authorityWeights?: Record<string, number>): IntentCategory {
  if (intents.length === 0) return "STABLE_DOMINANT";

  const nonDegraded = intents.filter(i => !i.degraded);
  const pool = nonDegraded.length > 0 ? nonDegraded : intents;

  const categoryVotes: Record<IntentCategory, number> = {
    DEFENSIVE: 0,
    AGGRESSIVE_SCALING: 0,
    TESTING: 0,
    POSITIONING_SHIFT: 0,
    PRICE_WAR: 0,
    DECLINING: 0,
    STABLE_DOMINANT: 0,
  };

  for (const intent of pool) {
    const weight = authorityWeights?.[intent.competitorId] ?? 1;
    categoryVotes[intent.intentCategory] += intent.intentScore * Math.max(0.3, weight);
  }

  return selectDominantIntent(categoryVotes);
}
