import type { CompetitorSignalResult, IntentCategory, IntentResult, SignalData } from "./types";
import { MI_INTENT_WEIGHTS, MI_CONFIDENCE } from "./constants";

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
  const secondMax = Object.values(scores).sort((a, b) => b - a)[1] || 0;
  if (maxScore - secondMax < 0.05) {
    degraded = true;
    degradeReason = `Ambiguous intent: top scores too close (${maxScore.toFixed(3)} vs ${secondMax.toFixed(3)})`;
  }

  return {
    competitorId: signalResult.competitorId,
    competitorName: signalResult.competitorName,
    intentCategory,
    intentScore: scores[intentCategory],
    scores,
    degraded,
    degradeReason,
  };
}

export function classifyAllIntents(signalResults: CompetitorSignalResult[]): IntentResult[] {
  return signalResults.map(classifyCompetitorIntent);
}

export function computeDominantMarketIntent(intents: IntentResult[]): IntentCategory {
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
    categoryVotes[intent.intentCategory] += intent.intentScore;
  }

  return selectDominantIntent(categoryVotes);
}
