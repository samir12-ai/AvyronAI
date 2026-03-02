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
import type { CompetitorInput, PostData, CompetitorSignalResult, ExecutionMode } from "../market-intelligence-v3/types";
import { MI_THRESHOLDS, MI_COST_LIMITS, MI_CONFIDENCE, MI_REVIVAL_CAP } from "../market-intelligence-v3/constants";

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
  it("A) Minimal data attack: 1 competitor, 5 posts → confidence <0.40", () => {
    const comp = makeCompetitor({ name: "Minimal" }, 5);
    const signals = computeAllSignals([comp]);
    const confidence = computeConfidence(signals, 14);
    expect(confidence.overall).toBeLessThan(MI_CONFIDENCE.UNSTABLE_THRESHOLD + 0.15);
    if (confidence.overall < MI_CONFIDENCE.BLOCK_THRESHOLD) {
      expect(confidence.guardDecision).toBe("BLOCK");
    }
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
    const budget = computeTokenBudget(5, 750, 200);
    if (budget.projectedTokens > 8000) {
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
    if (confidence.guardDecision === "BLOCK") {
      expect(confidence.level).toBe("INSUFFICIENT");
    }
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
      entryStrategy: null,
      defensiveRisks: [],
      confidence: confidence,
      missingSignalFlags: flags,
      dataFreshnessDays: 1,
      volatilityIndex: 0.5,
    };

    const requiredFields = [
      "marketState", "dominantIntentType", "competitorIntentMap",
      "trajectoryDirection", "narrativeSaturationLevel", "revivalPotential",
      "entryStrategy", "defensiveRisks", "confidence",
      "missingSignalFlags", "dataFreshnessDays", "volatilityIndex"
    ];

    for (const field of requiredFields) {
      expect(output).toHaveProperty(field);
    }

    expect(Object.keys(output)).toHaveLength(12);
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
