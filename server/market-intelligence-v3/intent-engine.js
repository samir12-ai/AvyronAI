import { MI_INTENT_WEIGHTS, MI_CONFIDENCE, MI_THRESHOLDS } from "./constants";
function computeIntentScores(signals) {
    const categories = Object.keys(MI_INTENT_WEIGHTS);
    const scores = {};
    for (const category of categories) {
        const weights = MI_INTENT_WEIGHTS[category];
        let score = 0;
        for (const [key, weight] of Object.entries(weights)) {
            const signalValue = signals[key] || 0;
            score += signalValue * weight;
        }
        scores[category] = Math.round(Math.max(0, Math.min(1, (score + 1) / 2)) * 1000) / 1000;
    }
    return scores;
}
function selectDominantIntent(scores) {
    let maxScore = -Infinity;
    let dominant = "STABLE_DOMINANT";
    for (const [category, score] of Object.entries(scores)) {
        if (score > maxScore) {
            maxScore = score;
            dominant = category;
        }
    }
    return dominant;
}
export function classifyCompetitorIntent(signalResult) {
    const scores = computeIntentScores(signalResult.signals);
    let intentCategory = selectDominantIntent(scores);
    let degraded = false;
    let degradeReason;
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
    let intentConfidenceBand;
    if (intentConfidence > 0.75)
        intentConfidenceBand = "STRONG";
    else if (intentConfidence >= 0.55)
        intentConfidenceBand = "MODERATE";
    else if (intentConfidence >= 0.40)
        intentConfidenceBand = "UNCERTAIN";
    else
        intentConfidenceBand = "DEGRADED";
    let intentStatus = "FINAL";
    let intentStatusReason;
    const postCount = signalResult.sampleSize - (signalResult.commentCount ?? 0);
    const commentCount = signalResult.commentCount ?? 0;
    const provisionalReasons = [];
    if (postCount < MI_THRESHOLDS.MIN_POSTS_PER_COMPETITOR) {
        provisionalReasons.push(`posts < ${MI_THRESHOLDS.MIN_POSTS_PER_COMPETITOR} (have ${postCount})`);
    }
    if (provisionalReasons.length > 0) {
        intentStatus = "PROVISIONAL";
        intentStatusReason = provisionalReasons.join("; ");
        console.log(`[IntentEngine] PROVISIONAL intent for ${signalResult.competitorName}: ${intentStatusReason}`);
    }
    else if (commentCount < MI_THRESHOLDS.MIN_COMMENTS_SAMPLE) {
        console.log(`[IntentEngine] LOW_COMMENT_TEXT for ${signalResult.competitorName}: comments=${commentCount} < ${MI_THRESHOLDS.MIN_COMMENTS_SAMPLE} — classifying from post signals only`);
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
export function classifyAllIntents(signalResults) {
    return signalResults.map(classifyCompetitorIntent);
}
export function computeDominantMarketIntent(intents, authorityWeights) {
    if (intents.length === 0)
        return "STABLE_DOMINANT";
    const nonDegraded = intents.filter(i => !i.degraded);
    const pool = nonDegraded.length > 0 ? nonDegraded : intents;
    const categoryVotes = {
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
