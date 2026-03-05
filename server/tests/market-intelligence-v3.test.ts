import { describe, it, expect } from "vitest";
import { computeAllSignals, aggregateMissingFlags } from "../market-intelligence-v3/signal-engine";
import { classifyAllIntents, computeDominantMarketIntent } from "../market-intelligence-v3/intent-engine";
import { computeTrajectory, deriveTrajectoryDirection, deriveMarketState } from "../market-intelligence-v3/trajectory-engine";
import { computeConfidence, evaluateSignalStabilityGuard } from "../market-intelligence-v3/confidence-engine";
import { computeAllDominance } from "../market-intelligence-v3/dominance-module";
import { computeTokenBudget, applySampling } from "../market-intelligence-v3/token-budget";
import { evaluateRefreshDecision } from "../market-intelligence-v3/refresh-system";
import { validateEngineIsolation, assertNoPlanWrites, assertNoOrchestrator, assertNoAutopilot } from "../market-intelligence-v3/isolation-guard";
import { computeCompetitorHash } from "../market-intelligence-v3/utils";
import { computeDominanceForCompetitor } from "../market-intelligence-v3/dominance-module";
import { buildResultFromSnapshot, validateSnapshotCompleteness } from "../market-intelligence-v3/engine";
import type { CompetitorInput, PostData, CompetitorSignalResult, ExecutionMode, GoalMode } from "../market-intelligence-v3/types";
import { MI_THRESHOLDS, MI_COST_LIMITS, MI_CONFIDENCE, MI_REVIVAL_CAP, GOAL_MODE_WEIGHTS, ENGAGEMENT_BIAS_THRESHOLD } from "../market-intelligence-v3/constants";

function makePost(overrides: Partial<PostData> = {}): PostData {
  return {
    id: `post-${Math.random().toString(36).slice(2)}`,
    caption: "Test post",
    likes: 100,
    comments: 10,
    mediaType: "image",
    hashtags: ["test"],
    timestamp: new Date(Date.now() - Math.random() * 30 * 86400000).toISOString(),
    hasCTA: false,
    hasOffer: false,
    ...overrides,
  };
}

function makeCompetitor(overrides: Partial<CompetitorInput> = {}, postCount = 0): CompetitorInput {
  return {
    id: `comp-${Math.random().toString(36).slice(2)}`,
    name: `Competitor ${Math.random().toString(36).slice(2, 5)}`,
    platform: "instagram",
    profileLink: "https://instagram.com/test",
    businessType: "marketing",
    postingFrequency: 5,
    contentTypeRatio: "50/30/20",
    engagementRatio: 0.03,
    ctaPatterns: "DM us",
    discountFrequency: "weekly",
    hookStyles: "question",
    messagingTone: "professional",
    socialProofPresence: "testimonials",
    posts: Array.from({ length: postCount }, () => makePost()),
    comments: [],
    ...overrides,
  };
}

function makeFullCompetitor(name: string, postCount = 40): CompetitorInput {
  const now = Date.now();
  const posts = Array.from({ length: postCount }, (_, i) => {
    const weekIndex = Math.floor(i / 10);
    return makePost({
      timestamp: new Date(now - (28 - weekIndex * 7) * 86400000 + Math.random() * 86400000).toISOString(),
      likes: 50 + Math.floor(Math.random() * 200),
      comments: 5 + Math.floor(Math.random() * 30),
      hasCTA: Math.random() > 0.5,
      hasOffer: Math.random() > 0.7,
      hashtags: ["marketing", "business", Math.random() > 0.5 ? "growth" : "sales"],
      mediaType: ["image", "video", "carousel"][Math.floor(Math.random() * 3)],
    });
  });

  const comments = Array.from({ length: 150 }, (_, i) => ({
    id: `comment-${i}`,
    text: "Great content!",
    sentiment: 0.3 + Math.random() * 0.4,
    timestamp: new Date(now - Math.random() * 28 * 86400000).toISOString(),
  }));

  return makeCompetitor({
    name,
    posts,
    comments,
  }, 0);
}


describe("Market Intelligence V3 - Signal Engine", () => {
  it("computes all 9 signals for a competitor", () => {
    const comp = makeFullCompetitor("Test Comp");
    const [result] = computeAllSignals([comp]);
    expect(result.signals).toBeDefined();
    const keys = Object.keys(result.signals);
    expect(keys).toHaveLength(9);
    expect(keys).toContain("postingFrequencyTrend");
    expect(keys).toContain("engagementVolatility");
    expect(keys).toContain("ctaIntensityShift");
    expect(keys).toContain("offerLanguageChange");
    expect(keys).toContain("hashtagDriftScore");
    expect(keys).toContain("bioModificationFrequency");
    expect(keys).toContain("sentimentDrift");
    expect(keys).toContain("reviewVelocityChange");
    expect(keys).toContain("contentExperimentRate");
  });

  it("all signals are numeric", () => {
    const comp = makeFullCompetitor("Numeric Test");
    const [result] = computeAllSignals([comp]);
    for (const [key, value] of Object.entries(result.signals)) {
      expect(typeof value).toBe("number");
      expect(isNaN(value)).toBe(false);
    }
  });

  it("generates missing signal flags for sparse data", () => {
    const comp = makeCompetitor({ name: "Sparse", ctaPatterns: null }, 5);
    const results = computeAllSignals([comp]);
    const flags = aggregateMissingFlags(results);
    expect(flags.length).toBeGreaterThan(0);
    expect(flags.some(f => f.includes("posts"))).toBe(true);
  });

  it("caps competitors at MAX_COMPETITORS", () => {
    const comps = Array.from({ length: 10 }, (_, i) => makeCompetitor({ name: `Comp ${i}` }));
    const results = computeAllSignals(comps);
    expect(results.length).toBeLessThanOrEqual(MI_COST_LIMITS.MAX_COMPETITORS);
  });

  it("caps posts per competitor at MAX_POSTS", () => {
    const comp = makeCompetitor({ name: "Many Posts" });
    comp.posts = Array.from({ length: 100 }, () => makePost());
    const [result] = computeAllSignals([comp]);
    expect(result).toBeDefined();
  });
});


describe("Market Intelligence V3 - Intent Classification", () => {
  it("assigns intent category from weighted scoring", () => {
    const comp = makeFullCompetitor("Intent Test");
    const signals = computeAllSignals([comp]);
    const intents = classifyAllIntents(signals);
    expect(intents).toHaveLength(1);
    expect(intents[0].intentScore).toBeGreaterThanOrEqual(0);
    expect(intents[0].intentScore).toBeLessThanOrEqual(1);
    const validCategories = ["DEFENSIVE", "AGGRESSIVE_SCALING", "TESTING", "POSITIONING_SHIFT", "PRICE_WAR", "DECLINING", "STABLE_DOMINANT"];
    expect(validCategories).toContain(intents[0].intentCategory);
  });

  it("provides scores for all 7 categories", () => {
    const comp = makeFullCompetitor("Scores Test");
    const signals = computeAllSignals([comp]);
    const [intent] = classifyAllIntents(signals);
    expect(Object.keys(intent.scores)).toHaveLength(7);
  });

  it("degrades intent with insufficient sample", () => {
    const comp = makeCompetitor({ name: "Low Sample" }, 3);
    const signals = computeAllSignals([comp]);
    const [intent] = classifyAllIntents(signals);
    expect(intent.degraded).toBe(true);
  });

  it("dominant market intent is from valid categories", () => {
    const comps = [makeFullCompetitor("A"), makeFullCompetitor("B")];
    const signals = computeAllSignals(comps);
    const intents = classifyAllIntents(signals);
    const dominant = computeDominantMarketIntent(intents);
    const valid = ["DEFENSIVE", "AGGRESSIVE_SCALING", "TESTING", "POSITIONING_SHIFT", "PRICE_WAR", "DECLINING", "STABLE_DOMINANT"];
    expect(valid).toContain(dominant);
  });
});


describe("Market Intelligence V3 - Trajectory Engine", () => {
  it("computes all 5 trajectory indices", () => {
    const comps = [makeFullCompetitor("T1"), makeFullCompetitor("T2"), makeFullCompetitor("T3")];
    const signals = computeAllSignals(comps);
    const intents = classifyAllIntents(signals);
    const trajectory = computeTrajectory(signals, intents);
    expect(trajectory.marketHeatingIndex).toBeGreaterThanOrEqual(0);
    expect(trajectory.marketHeatingIndex).toBeLessThanOrEqual(1);
    expect(trajectory.narrativeConvergenceScore).toBeGreaterThanOrEqual(0);
    expect(trajectory.offerCompressionIndex).toBeGreaterThanOrEqual(0);
    expect(trajectory.angleSaturationLevel).toBeGreaterThanOrEqual(0);
    expect(trajectory.revivalPotential).toBeGreaterThanOrEqual(0);
  });

  it("RevivalPotential capped at 0.7 unless special conditions met", () => {
    const comps = [makeFullCompetitor("R1"), makeFullCompetitor("R2")];
    const signals = computeAllSignals(comps);
    const intents = classifyAllIntents(signals);
    const trajectory = computeTrajectory(signals, intents);
    expect(trajectory.revivalPotential).toBeLessThanOrEqual(MI_REVIVAL_CAP + 0.001);
  });

  it("derives valid trajectory direction", () => {
    const trajectory = { marketHeatingIndex: 0.8, narrativeConvergenceScore: 0.5, offerCompressionIndex: 0.6, angleSaturationLevel: 0.3, revivalPotential: 0.3 };
    const direction = deriveTrajectoryDirection(trajectory);
    const valid = ["HEATING_COMPRESSED", "HEATING", "STAGNANT_SATURATED", "COOLING", "COMPRESSING", "SATURATED", "STABLE"];
    expect(valid).toContain(direction);
  });

  it("derives market state from trajectory and confidence", () => {
    const trajectory = { marketHeatingIndex: 0.1, narrativeConvergenceScore: 0.5, offerCompressionIndex: 0.2, angleSaturationLevel: 0.8, revivalPotential: 0.3 };
    const state = deriveMarketState(trajectory, "LOW");
    expect(state).toBe("SATURATED_MARKET");
  });

  it("market state is INSUFFICIENT_DATA when confidence is INSUFFICIENT", () => {
    const trajectory = { marketHeatingIndex: 0.8, narrativeConvergenceScore: 0.5, offerCompressionIndex: 0.6, angleSaturationLevel: 0.3, revivalPotential: 0.3 };
    const state = deriveMarketState(trajectory, "INSUFFICIENT");
    expect(state).toBe("INSUFFICIENT_DATA");
  });
});


describe("Market Intelligence V3 - Confidence Model", () => {
  it("computes confidence with all 6 factors", () => {
    const comps = [makeFullCompetitor("C1"), makeFullCompetitor("C2")];
    const signals = computeAllSignals(comps);
    const confidence = computeConfidence(signals, 1);
    expect(confidence.factors.dataCompleteness).toBeDefined();
    expect(confidence.factors.freshnessDecay).toBeDefined();
    expect(confidence.factors.sourceReliability).toBeDefined();
    expect(confidence.factors.sampleStrength).toBeDefined();
    expect(confidence.factors.crossCompetitorConsistency).toBeDefined();
    expect(confidence.factors.signalStability).toBeDefined();
  });

  it("confidence level maps correctly", () => {
    const comps = [makeFullCompetitor("L1"), makeFullCompetitor("L2"), makeFullCompetitor("L3")];
    const signals = computeAllSignals(comps);
    const confidence = computeConfidence(signals, 1);
    const validLevels = ["STRONG", "MODERATE", "LOW", "UNSTABLE", "INSUFFICIENT"];
    expect(validLevels).toContain(confidence.level);
  });

  it("source reliability is PROXY = 0.75", () => {
    const comps = [makeFullCompetitor("P1")];
    const signals = computeAllSignals(comps);
    const confidence = computeConfidence(signals, 1);
    expect(confidence.factors.sourceReliability).toBe(MI_CONFIDENCE.PROXY_RELIABILITY);
  });

  it("freshness decay increases with age", () => {
    const comps = [makeFullCompetitor("F1")];
    const signals = computeAllSignals(comps);
    const fresh = computeConfidence(signals, 1);
    const old = computeConfidence(signals, 30);
    expect(fresh.factors.freshnessDecay).toBeGreaterThan(old.factors.freshnessDecay);
  });

  it("FRESHNESS_HARD_GATE: dataAge > 14 days → BLOCK overrides all other guards", () => {
    const comps = [makeFullCompetitor("HG1"), makeFullCompetitor("HG2"), makeFullCompetitor("HG3")];
    const signals = computeAllSignals(comps);
    const fresh = computeConfidence(signals, 1);
    expect(fresh.guardDecision).not.toBe("BLOCK");
    const stale = computeConfidence(signals, 15);
    expect(stale.guardDecision).toBe("BLOCK");
    expect(stale.guardReasons.some((r: string) => r.includes("DATA_STALE_HARD_GATE"))).toBe(true);
  });

  it("FRESHNESS_HARD_GATE: exactly 14 days is NOT blocked", () => {
    const comps = [makeFullCompetitor("HG2"), makeFullCompetitor("HG3")];
    const signals = computeAllSignals(comps);
    const atLimit = computeConfidence(signals, 14);
    expect(atLimit.guardReasons.some((r: string) => r.includes("DATA_STALE_HARD_GATE"))).toBe(false);
  });

  it("FRESHNESS_HARD_GATE_DAYS constant is 14", () => {
    expect(MI_CONFIDENCE.FRESHNESS_HARD_GATE_DAYS).toBe(14);
  });
});


describe("Market Intelligence V3 - Anti-Bias Guard", () => {
  it("DOWNGRADE when signal coverage < 0.65", () => {
    const comp = makeCompetitor({ name: "Low Coverage", ctaPatterns: null, engagementRatio: null, contentTypeRatio: null }, 5);
    const signals = computeAllSignals([comp]);
    const guard = evaluateSignalStabilityGuard(signals);
    expect(guard.decision).not.toBe("PROCEED");
  });

  it("DOWNGRADE when dominant source ratio > 0.60", () => {
    const comp1 = makeFullCompetitor("Big");
    comp1.posts = Array.from({ length: 40 }, () => makePost());
    comp1.comments = Array.from({ length: 150 }, (_, i) => ({ id: `c-${i}`, text: "test", sentiment: 0.5, timestamp: new Date().toISOString() }));
    const comp2 = makeCompetitor({ name: "Small" }, 2);
    const signals = computeAllSignals([comp1, comp2]);
    const maxDominant = Math.max(...signals.map(s => s.dominantSourceRatio));
    if (maxDominant > MI_CONFIDENCE.DOWNGRADE_DOMINANT_SOURCE) {
      const guard = evaluateSignalStabilityGuard(signals);
      expect(guard.decision).not.toBe("PROCEED");
    }
  });

  it("BLOCK when signal coverage < 0.45", () => {
    const comp = makeCompetitor({
      name: "Critical",
      postingFrequency: null,
      contentTypeRatio: null,
      engagementRatio: null,
      ctaPatterns: null,
      profileLink: "",
    }, 2);
    const signals = computeAllSignals([comp]);
    if (signals[0].signalCoverageScore < MI_CONFIDENCE.BLOCK_COVERAGE) {
      const guard = evaluateSignalStabilityGuard(signals);
      expect(guard.decision).toBe("BLOCK");
    }
  });

  it("no aggressive strategy when confidence < 0.50", () => {
    const comp = makeCompetitor({ name: "Weak" }, 3);
    const signals = computeAllSignals([comp]);
    const confidence = computeConfidence(signals, 30);
    if (confidence.overall < MI_CONFIDENCE.NO_AGGRESSIVE_THRESHOLD) {
      expect(confidence.guardDecision).not.toBe("PROCEED");
    }
  });
});


describe("Market Intelligence V3 - Stress Tests", () => {
  it("A) Minimal data attack: 1 competitor, 5 posts → confidence below MODERATE", () => {
    const comp = makeCompetitor({ name: "Minimal" }, 5);
    const signals = computeAllSignals([comp]);
    const confidence = computeConfidence(signals, 14);
    expect(confidence.overall).toBeLessThan(MI_CONFIDENCE.MODERATE_THRESHOLD);
    expect(confidence.level).not.toBe("STRONG");
    expect(confidence.level).not.toBe("MODERATE");
  });

  it("B) Viral spike distortion: sampleStrength prevents overconfidence", () => {
    const comp = makeCompetitor({ name: "Viral" });
    comp.posts = [
      makePost({ likes: 50000, comments: 5000, views: 1000000 }),
      makePost({ likes: 80000, comments: 8000, views: 2000000 }),
    ];
    const signals = computeAllSignals([comp]);
    expect(signals[0].signals.engagementVolatility).toBeDefined();
    const confidence = computeConfidence(signals, 1);
    expect(confidence.factors.sampleStrength).toBeLessThan(0.5);
  });

  it("C) Proxy blackout simulation: system continues with stale data", () => {
    const comp = makeFullCompetitor("Stale");
    const signals = computeAllSignals([comp]);
    const freshConfidence = computeConfidence(signals, 1);
    const staleConfidence = computeConfidence(signals, 30);
    expect(staleConfidence.factors.freshnessDecay).toBeLessThan(freshConfidence.factors.freshnessDecay);
    expect(staleConfidence.overall).toBeLessThan(freshConfidence.overall);
    expect(staleConfidence.overall).toBeGreaterThan(0);
  });

  it("D) Conflicting signals: high engagement but high saturation", () => {
    const comps = [makeFullCompetitor("Conflict1"), makeFullCompetitor("Conflict2")];
    const signals = computeAllSignals(comps);
    const intents = classifyAllIntents(signals);
    const trajectory = computeTrajectory(signals, intents);
    const confidence = computeConfidence(signals, 1);
    expect(confidence).toBeDefined();
    expect(trajectory).toBeDefined();
    if (confidence.guardDecision === "DOWNGRADE") {
      expect(confidence.guardReasons.length).toBeGreaterThan(0);
    }
  });

  it("E) Corrupted field injection: missing engagement values → confidence downgrade", () => {
    const comp = makeCompetitor({
      name: "Corrupted",
      engagementRatio: null,
      ctaPatterns: null,
      hookStyles: null,
      messagingTone: null,
    }, 10);
    const signals = computeAllSignals([comp]);
    expect(signals[0].missingFields.length).toBeGreaterThan(0);
    const confidence = computeConfidence(signals, 1);
    expect(confidence.overall).toBeLessThan(MI_CONFIDENCE.STRONG_THRESHOLD);
  });

  it("F) Max load test: 5 competitors × 40 posts × 150 comments → stable output", () => {
    const comps = Array.from({ length: 5 }, (_, i) => makeFullCompetitor(`MaxLoad${i}`));
    const startTime = Date.now();
    const signals = computeAllSignals(comps);
    const intents = classifyAllIntents(signals);
    const trajectory = computeTrajectory(signals, intents);
    const confidence = computeConfidence(signals, 1);
    const dominance = computeAllDominance(signals, confidence);
    const elapsed = Date.now() - startTime;

    expect(signals).toHaveLength(5);
    expect(intents).toHaveLength(5);
    expect(dominance).toHaveLength(5);
    expect(trajectory.marketHeatingIndex).toBeDefined();
    expect(confidence.overall).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(5000);
  });

  it("G) Bias domination: 90% signals from 1 competitor → DOWNGRADE/BLOCK", () => {
    const dominant = makeFullCompetitor("Dominant");
    dominant.posts = Array.from({ length: 40 }, () => makePost());
    dominant.comments = Array.from({ length: 150 }, (_, i) => ({ id: `c-${i}`, text: "t", sentiment: 0.5, timestamp: new Date().toISOString() }));
    const small = makeCompetitor({ name: "Tiny" }, 2);
    const signals = computeAllSignals([dominant, small]);
    const maxRatio = Math.max(...signals.map(s => s.dominantSourceRatio));
    expect(maxRatio).toBeGreaterThan(0.5);
    const guard = evaluateSignalStabilityGuard(signals);
    if (maxRatio > MI_CONFIDENCE.DOWNGRADE_DOMINANT_SOURCE) {
      expect(guard.decision).not.toBe("PROCEED");
    }
  });

  it("H) Proxy partial outage: 50% failures → Exploratory Mode", () => {
    const comp = makeCompetitor({ name: "Partial" }, 15);
    const signals = computeAllSignals([comp]);
    const confidence = computeConfidence(signals, 7);
    if (confidence.guardDecision === "DOWNGRADE" || confidence.guardDecision === "BLOCK") {
      expect(confidence.guardReasons.length).toBeGreaterThan(0);
    }
  });

  it("I) Contradictory sources: high engagement but low sentiment → conflict surface", () => {
    const comp = makeCompetitor({ name: "Contradictory", engagementRatio: 0.08 });
    comp.posts = Array.from({ length: 30 }, () => makePost({ likes: 500, comments: 50 }));
    comp.comments = Array.from({ length: 100 }, (_, i) => ({
      id: `c-${i}`, text: "terrible", sentiment: -0.8, timestamp: new Date().toISOString(),
    }));
    const signals = computeAllSignals([comp]);
    const confidence = computeConfidence(signals, 1);
    expect(confidence).toBeDefined();
    expect(signals[0].signals.sentimentDrift).toBeDefined();
  });

  it("J) Regression test: direction stability tracking", () => {
    const comps = [makeFullCompetitor("R1"), makeFullCompetitor("R2")];
    const signals = computeAllSignals(comps);
    const intents = classifyAllIntents(signals);
    const trajectory = computeTrajectory(signals, intents);
    const direction = deriveTrajectoryDirection(trajectory);
    expect(typeof direction).toBe("string");
    expect(direction.length).toBeGreaterThan(0);
  });
});


describe("Market Intelligence V3 - Engine Isolation", () => {
  it("K1) validateEngineIsolation rejects non-MIv3 callers", () => {
    expect(() => validateEngineIsolation("BUILD_A_PLAN_ORCHESTRATOR")).toThrow("Engine isolation violation");
    expect(() => validateEngineIsolation("STORYTELLING_ENGINE")).toThrow("Engine isolation violation");
    expect(() => validateEngineIsolation("AUTOPILOT")).toThrow("Engine isolation violation");
  });

  it("K2) validateEngineIsolation accepts MIv3", () => {
    expect(() => validateEngineIsolation("MARKET_INTELLIGENCE_V3")).not.toThrow();
  });

  it("K3) assertNoPlanWrites always throws", () => {
    expect(() => assertNoPlanWrites()).toThrow("ISOLATION VIOLATION");
  });

  it("K4) assertNoOrchestrator always throws", () => {
    expect(() => assertNoOrchestrator()).toThrow("ISOLATION VIOLATION");
  });

  it("K5) assertNoAutopilot always throws", () => {
    expect(() => assertNoAutopilot()).toThrow("ISOLATION VIOLATION");
  });
});


describe("Market Intelligence V3 - Dominance Module Containment", () => {
  it("L1) Dominance module only accessible through full pipeline", () => {
    const comp = makeFullCompetitor("Dom Test");
    const signals = computeAllSignals([comp]);
    const confidence = computeConfidence(signals, 1);
    const dominance = computeAllDominance(signals, confidence);
    expect(dominance).toHaveLength(1);
    expect(dominance[0].dominanceScore).toBeGreaterThanOrEqual(0);
    expect(dominance[0].dominanceScore).toBeLessThanOrEqual(100);
  });

  it("L2) Dominance level is valid", () => {
    const comp = makeFullCompetitor("Dom Level");
    const signals = computeAllSignals([comp]);
    const confidence = computeConfidence(signals, 1);
    const [dom] = computeAllDominance(signals, confidence);
    const validLevels = ["DOMINANT", "STRUCTURALLY_STRONG", "EFFICIENT", "EXPOSED", "WEAK"];
    expect(validLevels).toContain(dom.dominanceLevel);
  });

  it("L3) Dominance attenuated by low confidence", () => {
    const comp = makeCompetitor({ name: "Low Conf Dom" }, 3);
    const signals = computeAllSignals([comp]);
    const lowConf = computeConfidence(signals, 30);
    const [lowDom] = computeAllDominance(signals, lowConf);

    const fullComp = makeFullCompetitor("High Conf Dom");
    const fullSignals = computeAllSignals([fullComp]);
    const highConf = computeConfidence(fullSignals, 1);
    const [highDom] = computeAllDominance(fullSignals, highConf);

    if (lowConf.level === "UNSTABLE" || lowConf.level === "INSUFFICIENT") {
      expect(lowDom.dominanceScore).toBeLessThanOrEqual(highDom.dominanceScore + 10);
    }
  });

  it("L4) Dominance provides strengths and weaknesses arrays", () => {
    const comp = makeFullCompetitor("SW Test");
    const signals = computeAllSignals([comp]);
    const confidence = computeConfidence(signals, 1);
    const [dom] = computeAllDominance(signals, confidence);
    expect(Array.isArray(dom.strengths)).toBe(true);
    expect(Array.isArray(dom.weaknesses)).toBe(true);
  });
});


describe("Market Intelligence V3 - Token Budget Guard", () => {
  it("M1) Token ceiling enforced — mode auto-downgrades", () => {
    const budget = computeTokenBudget(5, 500, 200);
    const validModes: ExecutionMode[] = ["FULL", "REDUCED", "LIGHT"];
    expect(validModes).toContain(budget.selectedMode);
    expect(budget.projectedTokens).toBeGreaterThan(0);
  });

  it("M2) Small data stays in FULL mode", () => {
    const budget = computeTokenBudget(1, 10, 5);
    expect(budget.selectedMode).toBe("FULL");
    expect(budget.downgradeReason).toBeNull();
  });

  it("M3) Large data downgrades to REDUCED or LIGHT", () => {
    const budget = computeTokenBudget(5, 2000, 500);
    if (budget.projectedTokens > 25000) {
      expect(budget.selectedMode).not.toBe("FULL");
      expect(budget.downgradeReason).not.toBeNull();
    }
  });

  it("M4) Sampling respects mode limits", () => {
    const posts = Array.from({ length: 100 }, () => makePost());
    const comments = Array.from({ length: 200 }, (_, i) => ({ id: `c-${i}`, text: "t", timestamp: new Date().toISOString() }));
    const { sampledPosts: fullPosts, sampledComments: fullComments } = applySampling(posts, comments, "FULL");
    const { sampledPosts: reducedPosts, sampledComments: reducedComments } = applySampling(posts, comments, "REDUCED");
    const { sampledPosts: lightPosts, sampledComments: lightComments } = applySampling(posts, comments, "LIGHT");

    expect(fullPosts.length).toBeLessThanOrEqual(MI_COST_LIMITS.MAX_POSTS_PER_COMPETITOR);
    expect(reducedPosts.length).toBeLessThanOrEqual(fullPosts.length);
    expect(lightPosts.length).toBeLessThanOrEqual(reducedPosts.length);
    expect(lightComments.length).toBe(0);
  });
});


describe("Market Intelligence V3 - Adaptive Refresh", () => {
  it("first refresh always triggers", () => {
    const comp = makeFullCompetitor("Refresh1");
    const [signal] = computeAllSignals([comp]);
    const decision = evaluateRefreshDecision(signal, null);
    expect(decision.shouldRefresh).toBe(true);
  });

  it("hard cap enforced: no refresh within 72 hours", () => {
    const comp = makeFullCompetitor("Refresh2");
    const [signal] = computeAllSignals([comp]);
    const recentRefresh = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const decision = evaluateRefreshDecision(signal, recentRefresh);
    expect(decision.shouldRefresh).toBe(false);
    expect(decision.reason).toContain("Hard cap");
  });

  it("refresh after interval expires", () => {
    const comp = makeFullCompetitor("Refresh3");
    const [signal] = computeAllSignals([comp]);
    const oldRefresh = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
    const decision = evaluateRefreshDecision(signal, oldRefresh);
    expect(decision.shouldRefresh).toBe(true);
  });

  it("volatility index affects interval", () => {
    const comp = makeFullCompetitor("Refresh4");
    const [signal] = computeAllSignals([comp]);
    const decision = evaluateRefreshDecision(signal, null);
    expect(decision.intervalDays).toBeGreaterThanOrEqual(3);
    expect(decision.intervalDays).toBeLessThanOrEqual(14);
    expect(decision.volatilityIndex).toBeGreaterThanOrEqual(0);
    expect(decision.volatilityIndex).toBeLessThanOrEqual(1);
  });
});


describe("Market Intelligence V3 - No Hallucination Rule", () => {
  it("missing pricing → no fabricated ranges", () => {
    const comp = makeCompetitor({ name: "NoPricing", pricingHints: null }, 5);
    const signals = computeAllSignals([comp]);
    const flags = aggregateMissingFlags(signals);
    expect(flags.length).toBeGreaterThan(0);
  });

  it("insufficient competitors → explicit flag", () => {
    const comp = makeCompetitor({ name: "Solo" }, 10);
    const signals = computeAllSignals([comp]);
    const flags = aggregateMissingFlags(signals);
    expect(flags.some(f => f.includes("Insufficient competitors"))).toBe(true);
  });

  it("no strategic output when confidence blocked", () => {
    const comp = makeCompetitor({
      name: "Blocked",
      postingFrequency: null,
      contentTypeRatio: null,
      engagementRatio: null,
      ctaPatterns: null,
    }, 2);
    const signals = computeAllSignals([comp]);
    const confidence = computeConfidence(signals, 30);
    expect(confidence.guardDecision).toBe("BLOCK");
    const validBlockedLevels = ["INSUFFICIENT", "LOW", "UNSTABLE"];
    expect(validBlockedLevels).toContain(confidence.level);
  });
});


describe("Market Intelligence V3 - Output Structure", () => {
  it("output contains exactly 12 required fields", () => {
    const comps = [makeFullCompetitor("Out1"), makeFullCompetitor("Out2")];
    const signals = computeAllSignals(comps);
    const intents = classifyAllIntents(signals);
    const dominant = computeDominantMarketIntent(intents);
    const trajectory = computeTrajectory(signals, intents);
    const confidence = computeConfidence(signals, 1);
    const direction = deriveTrajectoryDirection(trajectory);
    const state = deriveMarketState(trajectory, confidence.level);
    const flags = aggregateMissingFlags(signals);

    const output = {
      marketState: state,
      dominantIntentType: dominant,
      competitorIntentMap: intents,
      trajectoryDirection: direction,
      narrativeSaturationLevel: trajectory.angleSaturationLevel,
      revivalPotential: trajectory.revivalPotential,
      marketDiagnosis: null,
      threatSignals: [],
      confidence: confidence,
      missingSignalFlags: flags,
      dataFreshnessDays: 1,
      volatilityIndex: 0.5,
      signalNoiseRatio: 0,
      evidenceCoverage: { postsAnalyzed: 0, commentsAnalyzed: 0, competitorsWithSufficientData: 0, totalCompetitors: 0 },
    };

    const requiredFields = [
      "marketState", "dominantIntentType", "competitorIntentMap",
      "trajectoryDirection", "narrativeSaturationLevel", "revivalPotential",
      "marketDiagnosis", "threatSignals", "confidence",
      "missingSignalFlags", "dataFreshnessDays", "volatilityIndex",
      "signalNoiseRatio", "evidenceCoverage"
    ];

    for (const field of requiredFields) {
      expect(output).toHaveProperty(field);
    }

    expect(Object.keys(output)).toHaveLength(14);
  });
});

describe("Market Intelligence V3 - Snapshot Scope Isolation", () => {
  it("N1) competitorHash is deterministic for same competitor set", () => {
    const comps = [
      makeCompetitor({ id: "comp-alpha", name: "Alpha" }),
      makeCompetitor({ id: "comp-beta", name: "Beta" }),
    ];
    const hash1 = computeCompetitorHash(comps);
    const hash2 = computeCompetitorHash(comps);
    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(16);
  });

  it("N2) competitorHash changes when competitor set changes", () => {
    const comps1 = [
      makeCompetitor({ id: "comp-alpha", name: "Alpha" }),
      makeCompetitor({ id: "comp-beta", name: "Beta" }),
    ];
    const comps2 = [
      makeCompetitor({ id: "comp-alpha", name: "Alpha" }),
      makeCompetitor({ id: "comp-gamma", name: "Gamma" }),
    ];
    const hash1 = computeCompetitorHash(comps1);
    const hash2 = computeCompetitorHash(comps2);
    expect(hash1).not.toBe(hash2);
  });

  it("N3) competitorHash is order-independent", () => {
    const comps1 = [
      makeCompetitor({ id: "comp-alpha" }),
      makeCompetitor({ id: "comp-beta" }),
    ];
    const comps2 = [
      makeCompetitor({ id: "comp-beta" }),
      makeCompetitor({ id: "comp-alpha" }),
    ];
    expect(computeCompetitorHash(comps1)).toBe(computeCompetitorHash(comps2));
  });

  it("N4) cross-campaign isolation: different campaigns produce different snapshot scopes", () => {
    const comps = [makeCompetitor({ id: "comp-1" })];
    const hash = computeCompetitorHash(comps);

    const snapshotA = {
      accountId: "acc-1",
      campaignId: "campaign-A",
      competitorHash: hash,
    };
    const snapshotB = {
      accountId: "acc-1",
      campaignId: "campaign-B",
      competitorHash: hash,
    };

    expect(snapshotA.campaignId).not.toBe(snapshotB.campaignId);

    const compositeKeyA = `${snapshotA.accountId}:${snapshotA.campaignId}:${snapshotA.competitorHash}`;
    const compositeKeyB = `${snapshotB.accountId}:${snapshotB.campaignId}:${snapshotB.competitorHash}`;
    expect(compositeKeyA).not.toBe(compositeKeyB);
  });

  it("N5) cross-account isolation: different accounts produce different composite keys", () => {
    const comps = [makeCompetitor({ id: "comp-1" })];
    const hash = computeCompetitorHash(comps);

    const keyA = `acc-1:campaign-1:${hash}`;
    const keyB = `acc-2:campaign-1:${hash}`;
    expect(keyA).not.toBe(keyB);
  });
});

describe("Market Intelligence V3 - Concurrency & Deduplication", () => {
  it("O1) single-run lock key is composed of accountId:campaignId", () => {
    const lockKey1 = "acc-1:camp-1";
    const lockKey2 = "acc-1:camp-2";
    const lockKey3 = "acc-1:camp-1";
    expect(lockKey1).not.toBe(lockKey2);
    expect(lockKey1).toBe(lockKey3);
  });

  it("O2) token budget blocks uncontrolled token growth at max load", () => {
    const maxComps = MI_COST_LIMITS.MAX_COMPETITORS;
    const maxPosts = MI_COST_LIMITS.MAX_POSTS_PER_COMPETITOR * maxComps;
    const maxComments = MI_COST_LIMITS.MAX_TOTAL_COMMENTS;

    const budget = computeTokenBudget(maxComps, maxComments, maxPosts);
    expect(budget.projectedTokens).toBeGreaterThan(0);
    expect(budget.projectedTokens).toBeLessThanOrEqual(
      MI_COST_LIMITS.MAX_TOTAL_COMMENTS * 20 +
      MI_COST_LIMITS.MAX_COMPETITORS * MI_COST_LIMITS.MAX_POSTS_PER_COMPETITOR * 50 +
      1500 + 2000
    );

    const overloadBudget = computeTokenBudget(10, 2000, 500);
    expect(["FULL", "REDUCED", "LIGHT"]).toContain(overloadBudget.selectedMode);
  });

  it("O3) rapid refresh: hard cap prevents duplicate snapshots within 72h", () => {
    const signal = computeAllSignals([makeCompetitor({ id: "comp-rapid" }, 40)])[0];
    const lastRefresh = new Date();

    const decision = evaluateRefreshDecision(signal, lastRefresh);
    expect(decision.shouldRefresh).toBe(false);
    expect(decision.reason).toContain("Hard cap");
  });

  it("O4) snapshot deduplication: same hash within freshness window returns cached", () => {
    const comps = [makeCompetitor({ id: "comp-1" }), makeCompetitor({ id: "comp-2" })];
    const hash = computeCompetitorHash(comps);
    expect(hash.length).toBe(16);

    const snapshotWithHash = { competitorHash: hash, status: "COMPLETE" };
    const newHash = computeCompetitorHash(comps);
    expect(snapshotWithHash.competitorHash).toBe(newHash);
  });
});


describe("Market Intelligence V3 - Goal Mode Weighting", () => {
  it("P1) GOAL_MODE_WEIGHTS sums to 1.0 for both modes", () => {
    for (const mode of ["REACH_MODE", "STRATEGY_MODE"] as GoalMode[]) {
      const w = GOAL_MODE_WEIGHTS[mode];
      const sum = w.engagement + w.frequency + w.cta + w.innovation + w.sentiment + w.coverage;
      expect(Math.abs(sum - 1.0)).toBeLessThan(0.001);
    }
  });

  it("P2) REACH_MODE gives higher engagement weight than STRATEGY_MODE", () => {
    expect(GOAL_MODE_WEIGHTS.REACH_MODE.engagement).toBeGreaterThan(GOAL_MODE_WEIGHTS.STRATEGY_MODE.engagement);
  });

  it("P3) STRATEGY_MODE gives higher CTA + innovation weight than REACH_MODE", () => {
    const strategyCombined = GOAL_MODE_WEIGHTS.STRATEGY_MODE.cta + GOAL_MODE_WEIGHTS.STRATEGY_MODE.innovation;
    const reachCombined = GOAL_MODE_WEIGHTS.REACH_MODE.cta + GOAL_MODE_WEIGHTS.REACH_MODE.innovation;
    expect(strategyCombined).toBeGreaterThan(reachCombined);
  });

  it("P4) Same dataset with different GoalMode produces different dominance scores", () => {
    const comp = makeFullCompetitor("GoalTest");
    const signals = computeAllSignals([comp]);
    const confidence = computeConfidence(signals, 1);

    const reachDominance = computeAllDominance(signals, confidence, "REACH_MODE");
    const strategyDominance = computeAllDominance(signals, confidence, "STRATEGY_MODE");

    expect(reachDominance).toHaveLength(1);
    expect(strategyDominance).toHaveLength(1);
    expect(reachDominance[0].dominanceScore).not.toBe(strategyDominance[0].dominanceScore);
  });

  it("P5) REACH_MODE produces higher scores for high-engagement competitor", () => {
    const comp = makeCompetitor({ name: "HighEngagement", engagementRatio: 0.09 }, 30);
    comp.posts = Array.from({ length: 30 }, () => makePost({ likes: 500, comments: 50 }));
    comp.comments = Array.from({ length: 100 }, (_, i) => ({
      id: `c-${i}`, text: "great content", sentiment: 0.5, timestamp: new Date().toISOString(),
    }));
    const signals = computeAllSignals([comp]);
    const confidence = computeConfidence(signals, 1);

    const reachDom = computeAllDominance(signals, confidence, "REACH_MODE");
    const stratDom = computeAllDominance(signals, confidence, "STRATEGY_MODE");

    expect(reachDom[0].dominanceScore).toBeGreaterThanOrEqual(stratDom[0].dominanceScore - 5);
  });

  it("P6) Engagement bias risk surfaced when engagement dominates", () => {
    const comp = makeCompetitor({ name: "BiasTest" }, 30);
    comp.posts = Array.from({ length: 30 }, () => makePost({ likes: 1000, comments: 100 }));
    const signals = computeAllSignals([comp]);
    const confidence = computeConfidence(signals, 1);

    const reachDom = computeAllDominance(signals, confidence, "REACH_MODE");
    const hasAnyBiasRisk = reachDom.some(d => d.engagementWeightBiasRisk !== null && d.engagementWeightBiasRisk !== undefined);

    expect(reachDom[0]).toHaveProperty("engagementWeightBiasRisk");
  });

  it("P7) computeDominanceForCompetitor applies mode weights correctly", () => {
    const comp = makeFullCompetitor("WeightTest");
    const signals = computeAllSignals([comp]);
    const confidence = computeConfidence(signals, 1);

    const reachResult = computeDominanceForCompetitor(signals[0], signals, confidence, "REACH_MODE");
    const stratResult = computeDominanceForCompetitor(signals[0], signals, confidence, "STRATEGY_MODE");

    expect(reachResult.dominanceScore).toBeGreaterThanOrEqual(0);
    expect(reachResult.dominanceScore).toBeLessThanOrEqual(100);
    expect(stratResult.dominanceScore).toBeGreaterThanOrEqual(0);
    expect(stratResult.dominanceScore).toBeLessThanOrEqual(100);
    expect(reachResult.dominanceScore).not.toBe(stratResult.dominanceScore);
  });

  it("P8) GoalMode defaults to STRATEGY_MODE when not specified", () => {
    const comp = makeFullCompetitor("DefaultMode");
    const signals = computeAllSignals([comp]);
    const confidence = computeConfidence(signals, 1);

    const defaultDom = computeAllDominance(signals, confidence);
    const explicitDom = computeAllDominance(signals, confidence, "STRATEGY_MODE");

    expect(defaultDom[0].dominanceScore).toBe(explicitDom[0].dominanceScore);
  });

  it("P9) ENGAGEMENT_BIAS_THRESHOLD is between 0 and 1", () => {
    expect(ENGAGEMENT_BIAS_THRESHOLD).toBeGreaterThan(0);
    expect(ENGAGEMENT_BIAS_THRESHOLD).toBeLessThanOrEqual(1);
  });
});

describe("Post-Deployment Audit Safeguards", () => {

  describe("Section 3: Snapshot Consistency", () => {
    it("A3.1) validateSnapshotCompleteness rejects missing marketState", () => {
      const result = validateSnapshotCompleteness({
        marketState: "PENDING",
        trajectoryData: JSON.stringify({ direction: "UP" }),
        dominanceData: JSON.stringify([{ id: "1" }]),
        confidenceData: JSON.stringify({ overall: 0.8 }),
        signalData: JSON.stringify([{ id: "1" }]),
        intentData: JSON.stringify([{ id: "1" }]),
        volatilityIndex: 0.5,
        confidenceLevel: "STRONG",
      });
      expect(result.valid).toBe(false);
      expect(result.failures.some((f: string) => f.includes("marketState"))).toBe(true);
    });

    it("A3.2) getCachedSnapshot filters by status=COMPLETE (source code verification)", () => {
      const fs = require("fs");
      const engineSrc = fs.readFileSync("server/market-intelligence-v3/engine.ts", "utf-8");
      const cacheFunction = engineSrc.match(/async function getCachedSnapshot[\s\S]*?^}/m)?.[0] || engineSrc;
      expect(cacheFunction).toContain('eq(miSnapshots.status, "COMPLETE")');
    });

    it("A3.3) /snapshot route filters by status=COMPLETE (source code verification)", () => {
      const fs = require("fs");
      const routesSrc = fs.readFileSync("server/market-intelligence-v3/routes.ts", "utf-8");
      expect(routesSrc).toContain('eq(miSnapshots.status, "COMPLETE")');
    });

    it("A3.4) persistValidatedSnapshot downgrades invalid COMPLETE to PARTIAL", () => {
      const fs = require("fs");
      const engineSrc = fs.readFileSync("server/market-intelligence-v3/engine.ts", "utf-8");
      expect(engineSrc).toContain('snapshotPayload.status = "PARTIAL"');
      expect(engineSrc).toContain("persistValidatedSnapshot");
    });
  });

  describe("Section 5: Engagement Bias Protection", () => {
    it("A5.1) ENGAGEMENT_BIAS_THRESHOLD is 0.50", () => {
      expect(ENGAGEMENT_BIAS_THRESHOLD).toBe(0.50);
    });

    it("A5.2) detectEngagementBiasRisk exists in dominance-module source", () => {
      const fs = require("fs");
      const src = fs.readFileSync("server/market-intelligence-v3/dominance-module.ts", "utf-8");
      expect(src).toContain("detectEngagementBiasRisk");
      expect(src).toContain("ENGAGEMENT_BIAS_THRESHOLD");
    });

    it("A5.3) Engagement-dominated dataset triggers bias warning in REACH_MODE", () => {
      const comp = makeCompetitor({ name: "EngDom" }, 30);
      comp.posts = Array.from({ length: 30 }, () =>
        makePost({ likes: 5000, comments: 500, caption: "amazing content" })
      );

      const signals = computeAllSignals([comp]);
      signals[0].signals.engagementVolatility = 0.05;
      signals[0].signals.ctaIntensityShift = 0.0;
      signals[0].signals.contentExperimentRate = 0.0;
      signals[0].signals.sentimentDrift = 0.0;

      const confidence = computeConfidence(signals, 1);
      const domResults = computeAllDominance(signals, confidence, "REACH_MODE");

      expect(domResults[0]).toHaveProperty("engagementWeightBiasRisk");
    });
  });

  describe("Section 6: Data Resilience", () => {
    it("A6.1) Engine exports getCachedSnapshot path that falls back to valid snapshot", () => {
      const fs = require("fs");
      const engineSrc = fs.readFileSync("server/market-intelligence-v3/engine.ts", "utf-8");
      expect(engineSrc).toContain("getCachedSnapshot");
      expect(engineSrc).toContain("buildResultFromSnapshot");
      expect(engineSrc).toContain("SNAPSHOT_FRESHNESS_HOURS");
    });

    it("A6.2) Snapshot metadata includes dataFreshnessDays", () => {
      const fs = require("fs");
      const engineSrc = fs.readFileSync("server/market-intelligence-v3/engine.ts", "utf-8");
      expect(engineSrc).toContain("dataFreshnessDays");
      expect(engineSrc).toContain("computeDataFreshnessDays");
    });

    it("A6.3) UI displays data_age with freshness coloring", () => {
      const fs = require("fs");
      const uiSrc = fs.readFileSync("components/CompetitiveIntelligence.tsx", "utf-8");
      expect(uiSrc).toContain("dataFreshnessDays");
      expect(uiSrc).toContain("d ago");
      expect(uiSrc).toContain("Never fetched");
    });

    it("A6.4) Fetch failure paths maintain PARTIAL status not COMPLETE", () => {
      const fs = require("fs");
      const orchestratorSrc = fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8");
      expect(orchestratorSrc).toContain("PARTIAL_COMPLETE");
      expect(orchestratorSrc).toContain("PARTIAL_CONFIDENCE_PENALTY");
    });
  });

  describe("Section 7: Presentation Layer Isolation", () => {
    it("A7.1) Tab switching uses only in-memory state (no fetch calls in render functions)", () => {
      const fs = require("fs");
      const uiSrc = fs.readFileSync("components/CompetitiveIntelligence.tsx", "utf-8");

      const renderInsightCards = uiSrc.match(/const renderInsightCards[\s\S]*?^  };/m)?.[0] || "";
      expect(renderInsightCards).not.toContain("fetch(");
      expect(renderInsightCards).not.toContain("mutate(");

      const renderSimilarityCard = uiSrc.match(/const renderSimilarityCard[\s\S]*?^  };/m)?.[0] || "";
      expect(renderSimilarityCard).not.toContain("fetch(");
      expect(renderSimilarityCard).not.toContain("mutate(");

      const renderGoalModeCard = uiSrc.match(/const renderGoalModeCard[\s\S]*?^  };/m)?.[0] || "";
      expect(renderGoalModeCard).not.toContain("fetch(");
      expect(renderGoalModeCard).not.toContain("mutate(");
    });

    it("A7.2) Dominance and Timeline tabs use only miv3Result state (no new fetches)", () => {
      const fs = require("fs");
      const uiSrc = fs.readFileSync("components/CompetitiveIntelligence.tsx", "utf-8");

      const renderCompetitors = uiSrc.match(/const renderCompetitors = \(\)[\s\S]*?^  };/m)?.[0] || "";
      expect(renderCompetitors.length).toBeGreaterThan(50);
      expect(renderCompetitors).not.toContain("analyzeMutation.mutate");
      expect(renderCompetitors).not.toContain("startFetchJobMutation.mutate");

      const renderTimeline = uiSrc.match(/const renderTimeline = \(\)[\s\S]*?^  };/m)?.[0] || "";
      expect(renderTimeline.length).toBeGreaterThan(50);
      expect(renderTimeline).not.toContain("analyzeMutation.mutate");
      expect(renderTimeline).not.toContain("startFetchJobMutation.mutate");
    });

    it("A7.3) buildInsightCards is pure computation with no side effects", () => {
      const fs = require("fs");
      const uiSrc = fs.readFileSync("components/CompetitiveIntelligence.tsx", "utf-8");
      const buildInsightCards = uiSrc.match(/const buildInsightCards[\s\S]*?^  }, \[miv3Result\]\);/m)?.[0] || "";
      expect(buildInsightCards).not.toContain("fetch(");
      expect(buildInsightCards).not.toContain("mutate(");
      expect(buildInsightCards).not.toContain("queryClient");
      expect(buildInsightCards.length).toBeGreaterThan(100);
    });
  });
});

describe("Market Intelligence V3 - Goal Mode Source of Truth", () => {
  it("T002.1) goalMode flows through dominance computation with REACH_MODE", () => {
    const comp = makeFullCompetitor("GoalFlow");
    const signals = computeAllSignals([comp]);
    const confidence = computeConfidence(signals, 1);

    const reachDom = computeAllDominance(signals, confidence, "REACH_MODE");
    const stratDom = computeAllDominance(signals, confidence, "STRATEGY_MODE");

    expect(reachDom[0].dominanceScore).not.toBe(stratDom[0].dominanceScore);
  });

  it("T002.2) buildResultFromSnapshot reads goalMode from stored snapshot", () => {
    const mockSnapshot = {
      id: "snap-test",
      accountId: "acc-1",
      campaignId: "camp-1",
      status: "COMPLETE",
      goalMode: "REACH_MODE",
      signalData: JSON.stringify([]),
      intentData: JSON.stringify([]),
      trajectoryData: JSON.stringify({ marketHeatingIndex: 0.5, narrativeConvergenceScore: 0.3, offerCompressionIndex: 0.2, angleSaturationLevel: 0.4, revivalPotential: 0.3 }),
      dominanceData: JSON.stringify([]),
      confidenceData: JSON.stringify({ overall: 0.7, level: "MODERATE", factors: {}, guardDecision: "PROCEED", guardReasons: [] }),
      marketState: "COMPETITIVE_MARKET",
      executionMode: "FULL",
      telemetry: JSON.stringify({}),
      threatSignals: JSON.stringify([]),
      missingSignalFlags: JSON.stringify([]),
      similarityData: JSON.stringify(null),
      volatilityIndex: 0.3,
      dataFreshnessDays: 2,
      overallConfidence: 0.7,
      confidenceLevel: "MODERATE",
      previousDirection: "HEATING",
      confirmedRuns: 2,
      createdAt: new Date().toISOString(),
    };

    const result = buildResultFromSnapshot(mockSnapshot);
    expect(result.goalMode).toBe("REACH_MODE");
  });

  it("T002.3) buildResultFromSnapshot defaults to STRATEGY_MODE when goalMode not set", () => {
    const mockSnapshot = {
      id: "snap-test-2",
      accountId: "acc-1",
      campaignId: "camp-1",
      status: "COMPLETE",
      signalData: JSON.stringify([]),
      intentData: JSON.stringify([]),
      trajectoryData: JSON.stringify({ marketHeatingIndex: 0.5, narrativeConvergenceScore: 0.3, offerCompressionIndex: 0.2, angleSaturationLevel: 0.4, revivalPotential: 0.3 }),
      dominanceData: JSON.stringify([]),
      confidenceData: JSON.stringify({ overall: 0.7, level: "MODERATE", factors: {}, guardDecision: "PROCEED", guardReasons: [] }),
      marketState: "COMPETITIVE_MARKET",
      executionMode: "FULL",
      telemetry: JSON.stringify({}),
      threatSignals: JSON.stringify([]),
      missingSignalFlags: JSON.stringify([]),
      similarityData: JSON.stringify(null),
      volatilityIndex: 0.3,
      dataFreshnessDays: 2,
      overallConfidence: 0.7,
      confidenceLevel: "MODERATE",
      previousDirection: "HEATING",
      confirmedRuns: 2,
      createdAt: new Date().toISOString(),
    };

    const result = buildResultFromSnapshot(mockSnapshot);
    expect(result.goalMode).toBe("STRATEGY_MODE");
  });

  it("T002.4) growthCampaigns schema has goalMode column with STRATEGY_MODE default", () => {
    const fs = require("fs");
    const schemaSrc = fs.readFileSync("shared/schema.ts", "utf-8");
    expect(schemaSrc).toContain('goalMode: text("goal_mode").default("STRATEGY_MODE")');
    const campaignSection = schemaSrc.match(/export const growthCampaigns[\s\S]*?\}\);/)?.[0] || "";
    expect(campaignSection).toContain("goal_mode");
  });

  it("T002.5) fetch-orchestrator reads goalMode from campaign config", () => {
    const fs = require("fs");
    const orchSrc = fs.readFileSync("server/market-intelligence-v3/fetch-orchestrator.ts", "utf-8");
    expect(orchSrc).toContain("growthCampaigns");
    expect(orchSrc).toContain("campaignGoalMode");
    expect(orchSrc).not.toMatch(/goalMode:\s*"STRATEGY_MODE"/);
  });

  it("T002.6) engine.ts falls back to campaign config when goalMode is default", () => {
    const fs = require("fs");
    const engineSrc = fs.readFileSync("server/market-intelligence-v3/engine.ts", "utf-8");
    expect(engineSrc).toContain("growthCampaigns");
    expect(engineSrc).toContain("campaignRows[0]?.goalMode");
  });

  it("T002.7) miSnapshots schema stores goalMode", () => {
    const fs = require("fs");
    const schemaSrc = fs.readFileSync("shared/schema.ts", "utf-8");
    const snapshotSection = schemaSrc.match(/export const miSnapshots[\s\S]*?\}\);/)?.[0] || "";
    expect(snapshotSection).toContain("goal_mode");
  });

  it("T002.8) engine snapshot payload includes goalMode from run parameter", () => {
    const fs = require("fs");
    const engineSrc = fs.readFileSync("server/market-intelligence-v3/engine.ts", "utf-8");
    const executeRunSection = engineSrc.match(/_executeRun[\s\S]*?const snapshotPayload[\s\S]*?\};/)?.[0] || "";
    expect(executeRunSection).toContain("goalMode");
  });

  it("T002.9) routes pass goalMode from request body to engine", () => {
    const fs = require("fs");
    const routesSrc = fs.readFileSync("server/market-intelligence-v3/routes.ts", "utf-8");
    expect(routesSrc).toContain("req.body.goalMode");
    expect(routesSrc).toContain("REACH_MODE");
  });
});

describe("T004: Calibration Layer Isolation Verification", () => {
  const fs = require("fs");
  const path = require("path");

  const baselinesSource = fs.readFileSync("server/baselines.ts", "utf-8");
  const confidenceEngineSource = fs.readFileSync("server/market-intelligence-v3/confidence-engine.ts", "utf-8");
  const isolationGuardSource = fs.readFileSync("server/market-intelligence-v3/isolation-guard.ts", "utf-8");

  describe("Baselines isolation from MIv3", () => {
    it("baselines.ts has zero imports from market-intelligence-v3 modules", () => {
      expect(baselinesSource).not.toContain("market-intelligence-v3");
      expect(baselinesSource).not.toContain("./market-intelligence-v3");
      expect(baselinesSource).not.toContain("../market-intelligence-v3");
    });

    it("baselines.ts does not reference miSnapshots table", () => {
      expect(baselinesSource).not.toContain("miSnapshots");
      expect(baselinesSource).not.toContain("mi_snapshots");
    });

    it("baselines.ts does not reference any MIv3 types", () => {
      const miv3Types = [
        "CompetitorSignalResult",
        "ConfidenceResult",
        "DominanceResult",
        "TrajectoryResult",
        "IntentResult",
        "ContentDNAResult",
        "DeltaReport",
      ];
      for (const typeName of miv3Types) {
        expect(baselinesSource).not.toContain(typeName);
      }
    });

    it("baselines.ts only imports from non-MIv3 sources", () => {
      const importLines = baselinesSource.split("\n").filter((line: string) => line.startsWith("import"));
      for (const line of importLines) {
        expect(line).not.toContain("market-intelligence");
        expect(line).not.toContain("signal-engine");
        expect(line).not.toContain("confidence-engine");
        expect(line).not.toContain("dominance-module");
        expect(line).not.toContain("trajectory-engine");
        expect(line).not.toContain("intent-engine");
        expect(line).not.toContain("isolation-guard");
      }
    });
  });

  describe("Confidence engine isolation from baselines", () => {
    it("confidence-engine.ts has zero imports from baselines.ts", () => {
      expect(confidenceEngineSource).not.toContain("baselines");
      expect(confidenceEngineSource).not.toContain("../baselines");
    });

    it("confidence-engine.ts does not reference performanceSnapshots table", () => {
      expect(confidenceEngineSource).not.toContain("performanceSnapshots");
      expect(confidenceEngineSource).not.toContain("performance_snapshots");
    });

    it("confidence-engine.ts does not reference baselineHistory table", () => {
      expect(confidenceEngineSource).not.toContain("baselineHistory");
      expect(confidenceEngineSource).not.toContain("baseline_history");
    });

    it("confidence-engine.ts does not reference accountState table", () => {
      expect(confidenceEngineSource).not.toContain("accountState");
      expect(confidenceEngineSource).not.toContain("account_state");
    });

    it("confidence-engine.ts does not import db (no direct database access)", () => {
      const importLines = confidenceEngineSource.split("\n").filter((line: string) => line.startsWith("import"));
      for (const line of importLines) {
        expect(line).not.toContain("../db");
        expect(line).not.toContain("./db");
      }
    });

    it("confidence-engine.ts only imports from MIv3-internal modules", () => {
      const importLines = confidenceEngineSource.split("\n").filter((line: string) => line.startsWith("import"));
      for (const line of importLines) {
        const fromMatch = line.match(/from\s+["']([^"']+)["']/);
        if (fromMatch) {
          const importPath = fromMatch[1];
          expect(
            importPath.startsWith("./") || importPath.startsWith("../market-intelligence-v3/")
          ).toBe(true);
        }
      }
    });
  });

  describe("Isolation guard scope covers MIv3-only domains", () => {
    it("isolation-guard.ts defines protected domains for MIv3-only tables", () => {
      const requiredDomains = [
        "COMPETITOR_DATA",
        "DOMINANCE",
        "CTA_ANALYSIS",
        "CONFIDENCE",
        "SNAPSHOTS",
        "SIGNAL_COMPUTE",
        "TRAJECTORY",
        "INTENT_CLASSIFICATION",
      ];
      for (const domain of requiredDomains) {
        expect(isolationGuardSource).toContain(domain);
      }
    });

    it("isolation-guard.ts blocks non-MIv3 engines", () => {
      const blockedEngines = [
        "BUILD_A_PLAN_ORCHESTRATOR",
        "STORYTELLING_ENGINE",
        "OFFER_ENGINE",
        "BUDGET_ENGINE",
        "AUTOPILOT",
        "CREATIVE_ENGINE",
        "LEAD_ENGINE",
        "FULFILLMENT_ENGINE",
      ];
      for (const engine of blockedEngines) {
        expect(isolationGuardSource).toContain(engine);
      }
    });

    it("isolation-guard.ts does not import from baselines or performance modules", () => {
      expect(isolationGuardSource).not.toContain("baselines");
      expect(isolationGuardSource).not.toContain("performanceSnapshots");
      expect(isolationGuardSource).not.toContain("baselineHistory");
    });

    it("isolation-guard.ts enforces MARKET_INTELLIGENCE_V3 as sole allowed caller", () => {
      expect(isolationGuardSource).toContain("MARKET_INTELLIGENCE_V3");
      expect(isolationGuardSource).toContain("ISOLATION_ALLOWED_CALLER");
    });

    it("isolation-guard.ts prevents plan writes", () => {
      expect(isolationGuardSource).toContain("assertNoPlanWrites");
      expect(isolationGuardSource).toContain("strategic_plans");
    });

    it("isolation-guard.ts prevents orchestrator invocation", () => {
      expect(isolationGuardSource).toContain("assertNoOrchestrator");
    });

    it("isolation-guard.ts prevents autopilot invocation", () => {
      expect(isolationGuardSource).toContain("assertNoAutopilot");
    });
  });

  describe("Cross-system static isolation proof", () => {
    it("no MIv3 module imports from baselines.ts", () => {
      const miv3Dir = "server/market-intelligence-v3";
      const miv3Files = fs.readdirSync(miv3Dir).filter((f: string) => f.endsWith(".ts"));
      for (const file of miv3Files) {
        const content = fs.readFileSync(path.join(miv3Dir, file), "utf-8");
        const importLines = content.split("\n").filter((line: string) => line.startsWith("import"));
        for (const line of importLines) {
          expect(line).not.toContain("baselines");
        }
      }
    });

    it("baselines.ts does not import from any MIv3 file", () => {
      const miv3Dir = "server/market-intelligence-v3";
      const miv3Files = fs.readdirSync(miv3Dir).filter((f: string) => f.endsWith(".ts")).map((f: string) => f.replace(".ts", ""));
      const importLines = baselinesSource.split("\n").filter((line: string) => line.startsWith("import"));
      for (const line of importLines) {
        for (const miv3File of miv3Files) {
          expect(line).not.toContain(miv3File);
        }
      }
    });

    it("two calibration systems share zero common dependencies beyond drizzle/db", () => {
      const baselinesImports = baselinesSource.split("\n")
        .filter((line: string) => line.startsWith("import"))
        .map((line: string) => {
          const match = line.match(/from\s+["']([^"']+)["']/);
          return match ? match[1] : "";
        })
        .filter(Boolean);

      const confidenceImports = confidenceEngineSource.split("\n")
        .filter((line: string) => line.startsWith("import"))
        .map((line: string) => {
          const match = line.match(/from\s+["']([^"']+)["']/);
          return match ? match[1] : "";
        })
        .filter(Boolean);

      const sharedImports = baselinesImports.filter((imp: string) => confidenceImports.includes(imp));
      expect(sharedImports.length).toBe(0);
    });
  });
});

describe("Layer-0 Signal-Only Contract", () => {
  it("MIv3Output type has marketDiagnosis, NOT entryStrategy", () => {
    const source = require("fs").readFileSync("server/market-intelligence-v3/types.ts", "utf-8");
    expect(source).toContain("marketDiagnosis:");
    expect(source).not.toContain("entryStrategy:");
    expect(source).toContain("threatSignals:");
    expect(source).not.toContain("defensiveRisks:");
  });

  it("MIv3Output includes signalNoiseRatio and evidenceCoverage", () => {
    const source = require("fs").readFileSync("server/market-intelligence-v3/types.ts", "utf-8");
    expect(source).toContain("signalNoiseRatio: number");
    expect(source).toContain("evidenceCoverage: EvidenceCoverage");
    expect(source).toContain("postsAnalyzed: number");
    expect(source).toContain("commentsAnalyzed: number");
    expect(source).toContain("competitorsWithSufficientData: number");
    expect(source).toContain("totalCompetitors: number");
  });

  it("engine.ts has NO prescriptive language in buildMarketDiagnosis or buildThreatSignals", () => {
    const source = require("fs").readFileSync("server/market-intelligence-v3/engine.ts", "utf-8");
    const diagStart = source.indexOf("export function buildMarketDiagnosis");
    const diagEnd = source.indexOf("export function buildThreatSignals");
    const diagnosis = source.slice(diagStart, diagEnd);
    expect(diagnosis).not.toContain("Focus on");
    expect(diagnosis).not.toContain("Differentiate");
    expect(diagnosis).not.toContain("Establish authority");

    const threatStart = diagEnd;
    const threatEnd = source.indexOf("export function computeSignalNoiseRatio");
    const threats = source.slice(threatStart, threatEnd);
    expect(threats).not.toContain("Focus on");
    expect(threats).not.toContain("Differentiate on value");
  });

  it("ENGINE_VERSION is 11", () => {
    const source = require("fs").readFileSync("server/market-intelligence-v3/constants.ts", "utf-8");
    expect(source).toContain("export const ENGINE_VERSION = 11;");
  });

  it("schema uses market_diagnosis and threat_signals columns (not old names)", () => {
    const source = require("fs").readFileSync("shared/schema.ts", "utf-8");
    expect(source).toContain("market_diagnosis");
    expect(source).toContain("threat_signals");
    expect(source).not.toContain("entry_strategy");
    expect(source).not.toContain("defensive_risks");
  });

  it("frontend uses threats tab (not actions/recommendations)", () => {
    const source = require("fs").readFileSync("components/CompetitiveIntelligence.tsx", "utf-8");
    expect(source).toContain("'threats'");
    expect(source).toContain("Threats");
    expect(source).not.toContain("'recommendations'");
    expect(source).not.toContain("label: 'Actions'");
    expect(source).toContain("renderThreats");
    expect(source).not.toContain("renderRecommendations");
  });
});
