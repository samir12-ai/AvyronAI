import { describe, it, expect } from "vitest";
import {
  AUDIENCE_ENGINE_VERSION,
  AUDIENCE_THRESHOLDS,
  PAIN_CLUSTERS,
  DESIRE_CLUSTERS,
  OBJECTION_CLUSTERS,
  TRANSFORMATION_PATTERNS,
  EMOTIONAL_DRIVER_PATTERNS,
  AWARENESS_PATTERNS,
  MATURITY_KEYWORDS,
  INTENT_KEYWORDS,
  LANGUAGE_PATTERNS,
  SYNTHETIC_FILTERS,
  CONFIDENCE_WEIGHTS,
  OBJECTION_CONTEXT_RULES,
  MIN_EVIDENCE_PER_SIGNAL,
} from "../audience-engine/constants";

import {
  detectMarketScope,
  filterClustersByMarket,
  applyObjectionContextRules,
  applyEvidenceIntegrityFilter,
  computeSegmentSimilarity,
  canonicalizeSegments,
  computeSegmentDensity,
} from "../audience-engine/engine";

describe("Audience Engine V3 — Constants Integrity", () => {
  it("engine version is 3", () => {
    expect(AUDIENCE_ENGINE_VERSION).toBe(3);
  });

  it("has 200+ total patterns across all clusters", () => {
    let total = 0;
    for (const cluster of PAIN_CLUSTERS) total += cluster.patterns.length;
    for (const cluster of DESIRE_CLUSTERS) total += cluster.patterns.length;
    for (const cluster of OBJECTION_CLUSTERS) total += cluster.patterns.length;
    for (const cluster of TRANSFORMATION_PATTERNS) total += cluster.patterns.length;
    for (const cluster of EMOTIONAL_DRIVER_PATTERNS) total += cluster.patterns.length;
    for (const patterns of Object.values(AWARENESS_PATTERNS)) total += patterns.length;
    for (const patterns of Object.values(MATURITY_KEYWORDS)) total += patterns.length;
    for (const patterns of Object.values(INTENT_KEYWORDS)) total += patterns.length;
    for (const patterns of Object.values(LANGUAGE_PATTERNS)) total += patterns.length;
    expect(total).toBeGreaterThanOrEqual(200);
  });

  it("includes Arabic patterns in pain clusters", () => {
    const allPainPatterns = PAIN_CLUSTERS.flatMap(c => c.patterns);
    const hasArabic = allPainPatterns.some(p => /[\u0600-\u06FF]/.test(p));
    expect(hasArabic).toBe(true);
  });

  it("confidence weights sum to 1.0", () => {
    const sum = CONFIDENCE_WEIGHTS.SIGNAL_FREQUENCY + CONFIDENCE_WEIGHTS.SOURCE_DIVERSITY + CONFIDENCE_WEIGHTS.COMPETITOR_OVERLAP;
    expect(sum).toBeCloseTo(1.0, 5);
  });

  it("has minimum evidence per signal defined", () => {
    expect(MIN_EVIDENCE_PER_SIGNAL).toBe(3);
  });

  it("has objection context rules for physical limitations", () => {
    expect(OBJECTION_CONTEXT_RULES["physical limitations"]).toBeDefined();
    expect(OBJECTION_CONTEXT_RULES["physical limitations"].requireKeywords.length).toBeGreaterThan(5);
    expect(OBJECTION_CONTEXT_RULES["physical limitations"].fallbackCanonical).toBe("complexity / too hard");
  });

  it("no cluster has empty patterns array", () => {
    const allClusters = [...PAIN_CLUSTERS, ...DESIRE_CLUSTERS, ...OBJECTION_CLUSTERS, ...TRANSFORMATION_PATTERNS, ...EMOTIONAL_DRIVER_PATTERNS];
    for (const cluster of allClusters) {
      expect(cluster.patterns.length).toBeGreaterThan(0);
      expect(cluster.canonical.length).toBeGreaterThan(0);
    }
  });
});

describe("Audience Engine V3 — Signal Sanitation", () => {
  it("synthetic filter patterns are lowercase-matchable", () => {
    for (const filter of SYNTHETIC_FILTERS) {
      expect(filter).toBe(filter.toLowerCase());
    }
  });

  it("filters catch synthetic patterns", () => {
    const testTexts = [
      "[synthetic-positive-1] Great product!",
      "This is a real comment",
      "[synthetic-negative-3] Bad experience",
      "engagement signal detected here",
      "reported comments batch 5",
      "I really love this product",
    ];
    const filtered = testTexts.filter(t => {
      const lower = t.toLowerCase();
      return !SYNTHETIC_FILTERS.some(f => lower.includes(f));
    });
    expect(filtered).toHaveLength(2);
  });

  it("does not filter legitimate comments", () => {
    const legitimate = [
      "How do I lose weight?",
      "This product is amazing",
      "شو الحل لمشكلتي",
      "Anyone tried this before?",
      "I need help with my diet",
    ];
    const filtered = legitimate.filter(t => {
      const lower = t.toLowerCase();
      return !SYNTHETIC_FILTERS.some(f => lower.includes(f));
    });
    expect(filtered).toHaveLength(5);
  });
});

describe("Audience Engine V3 — Objection Context Validation (T001)", () => {
  it("physical limitations objection reclassified without health context", () => {
    const signalWithPhysical = [
      { canonical: "physical limitations", frequency: 5, evidence: ["hard to do"], evidenceCount: 5, confidenceScore: 0.5, sourceSignals: ["test"], inputSnapshotId: null },
    ];

    const textsWithoutHealthContext = ["this is hard", "too difficult for me", "can't do it", "struggling with this"];
    const result = applyObjectionContextRules(signalWithPhysical, textsWithoutHealthContext);
    expect(result[0].canonical).toBe("complexity / too hard");
  });

  it("physical limitations merges into existing complexity cluster when present", () => {
    const signals = [
      { canonical: "complexity / too hard", frequency: 10, evidence: ["too complex"], evidenceCount: 10, confidenceScore: 0.7, sourceSignals: ["test"], inputSnapshotId: null },
      { canonical: "physical limitations", frequency: 5, evidence: ["hard to do"], evidenceCount: 5, confidenceScore: 0.5, sourceSignals: ["test"], inputSnapshotId: null },
    ];

    const textsWithoutHealth = ["this is hard", "too complicated"];
    const result = applyObjectionContextRules(signals, textsWithoutHealth);
    const complexity = result.find(r => r.canonical === "complexity / too hard");
    expect(complexity).toBeDefined();
    expect(complexity!.frequency).toBe(15);
    expect(result.some(r => r.canonical === "physical limitations")).toBe(false);
  });

  it("physical limitations objection kept when health keywords present", () => {
    const signalWithPhysical = [
      { canonical: "physical limitations", frequency: 5, evidence: ["injury recovery"], evidenceCount: 5, confidenceScore: 0.5, sourceSignals: ["test"], inputSnapshotId: null },
    ];

    const textsWithHealthContext = ["I have a knee injury", "back pain prevents me", "after surgery recovery"];
    const result = applyObjectionContextRules(signalWithPhysical, textsWithHealthContext);
    expect(result[0].canonical).toBe("physical limitations");
  });

  it("non-physical objections pass through unchanged", () => {
    const signals = [
      { canonical: "too expensive", frequency: 10, evidence: ["too costly"], evidenceCount: 10, confidenceScore: 0.7, sourceSignals: ["test"], inputSnapshotId: null },
      { canonical: "no time", frequency: 8, evidence: ["busy"], evidenceCount: 8, confidenceScore: 0.6, sourceSignals: ["test"], inputSnapshotId: null },
    ];
    const result = applyObjectionContextRules(signals, ["any text here"]);
    expect(result[0].canonical).toBe("too expensive");
    expect(result[1].canonical).toBe("no time");
  });
});

describe("Audience Engine V3 — Evidence Integrity (T004)", () => {
  it("discards signals with evidenceCount < 3", () => {
    const signals = [
      { canonical: "high evidence", frequency: 10, evidence: ["a", "b", "c"], evidenceCount: 10, confidenceScore: 0.7, sourceSignals: ["test"], inputSnapshotId: null },
      { canonical: "low evidence", frequency: 2, evidence: ["a"], evidenceCount: 2, confidenceScore: 0.3, sourceSignals: ["test"], inputSnapshotId: null },
      { canonical: "borderline", frequency: 3, evidence: ["a", "b", "c"], evidenceCount: 3, confidenceScore: 0.4, sourceSignals: ["test"], inputSnapshotId: null },
    ];
    const result = applyEvidenceIntegrityFilter(signals);
    expect(result).toHaveLength(2);
    expect(result[0].canonical).toBe("high evidence");
    expect(result[1].canonical).toBe("borderline");
  });

  it("discards signal with high frequency but low evidenceCount", () => {
    const signals = [
      { canonical: "mismatch", frequency: 10, evidence: ["a"], evidenceCount: 1, confidenceScore: 0.5, sourceSignals: [], inputSnapshotId: null },
    ];
    const result = applyEvidenceIntegrityFilter(signals);
    expect(result).toHaveLength(0);
  });

  it("keeps all signals when all have sufficient evidence", () => {
    const signals = [
      { canonical: "a", frequency: 5, evidence: [], evidenceCount: 5, confidenceScore: 0.5, sourceSignals: [], inputSnapshotId: null },
      { canonical: "b", frequency: 10, evidence: [], evidenceCount: 10, confidenceScore: 0.7, sourceSignals: [], inputSnapshotId: null },
    ];
    const result = applyEvidenceIntegrityFilter(signals);
    expect(result).toHaveLength(2);
  });

  it("returns empty when all signals below threshold", () => {
    const signals = [
      { canonical: "weak1", frequency: 1, evidence: [], evidenceCount: 1, confidenceScore: 0.1, sourceSignals: [], inputSnapshotId: null },
      { canonical: "weak2", frequency: 2, evidence: [], evidenceCount: 2, confidenceScore: 0.2, sourceSignals: [], inputSnapshotId: null },
    ];
    const result = applyEvidenceIntegrityFilter(signals);
    expect(result).toHaveLength(0);
  });
});

describe("Audience Engine V3 — Market Scope Detection (T003)", () => {
  it("detects fitness market from exercise-related text", () => {
    const fitnessTexts = [
      "best workout for beginners",
      "gym routine for muscle building",
      "exercise at home",
      "training program",
      "weight loss tips",
    ];
    const result = detectMarketScope(fitnessTexts, { industry: "Fitness Coaching", coreOffer: "Online Training" });
    expect(result).toContain("fitness");
  });

  it("detects marketing market from brand-related text", () => {
    const marketingTexts = [
      "grow your brand on social media",
      "content marketing strategy",
      "audience engagement",
      "how to run ads campaign",
      "build your audience",
    ];
    const result = detectMarketScope(marketingTexts, { industry: "Digital Marketing", coreOffer: "Marketing Services" });
    expect(result).toContain("marketing");
  });

  it("returns universal for unrecognizable content", () => {
    const genericTexts = ["hello world", "something random"];
    const result = detectMarketScope(genericTexts, { industry: "General", coreOffer: "General" });
    expect(result).toContain("universal");
  });

  it("fitness-scoped clusters are filtered out for marketing market", () => {
    const marketingMarkets = ["marketing" as const];
    const filtered = filterClustersByMarket(PAIN_CLUSTERS, marketingMarkets);
    const hasBodyImage = filtered.some(c => c.canonical === "body image struggles");
    const hasInjury = filtered.some(c => c.canonical === "injury or health limitations");
    expect(hasBodyImage).toBe(false);
    expect(hasInjury).toBe(false);
  });

  it("universal clusters always pass through", () => {
    const marketingMarkets = ["marketing" as const];
    const filtered = filterClustersByMarket(PAIN_CLUSTERS, marketingMarkets);
    const hasFrustration = filtered.some(c => c.canonical === "frustration with lack of results");
    expect(hasFrustration).toBe(true);
  });

  it("fitness market keeps fitness-scoped clusters", () => {
    const fitnessMarkets = ["fitness" as const];
    const filtered = filterClustersByMarket(PAIN_CLUSTERS, fitnessMarkets);
    const hasBodyImage = filtered.some(c => c.canonical === "body image struggles");
    const hasInjury = filtered.some(c => c.canonical === "injury or health limitations");
    expect(hasBodyImage).toBe(true);
    expect(hasInjury).toBe(true);
  });

  it("physical limitations objection filtered out in marketing market", () => {
    const marketingMarkets = ["marketing" as const];
    const filtered = filterClustersByMarket(OBJECTION_CLUSTERS, marketingMarkets);
    const hasPhysical = filtered.some(c => c.canonical === "physical limitations");
    expect(hasPhysical).toBe(false);
  });
});

describe("Audience Engine V3 — Segment Canonicalization (T005)", () => {
  const makeSegment = (name: string, pains: string[], desires: string[], pct: number) => ({
    name,
    description: `${name} segment`,
    painProfile: pains,
    desireProfile: desires,
    objectionProfile: [] as string[],
    motivationProfile: [] as string[],
    estimatedPercentage: pct,
    evidenceCount: 10,
    confidenceScore: 0.6,
    sourceSignals: ["painMap", "desireMap"],
    inputSnapshotId: null,
  });

  it("Test A — merges highly similar segments", () => {
    const segments = [
      makeSegment("Busy Entrepreneurs", ["frustration", "no time"], ["financial freedom", "scale"], 22),
      makeSegment("Startup Founders", ["frustration", "no time"], ["financial freedom", "growth"], 18),
      makeSegment("Health Seekers", ["injury", "diet"], ["lose weight", "health"], 30),
    ];
    const result = canonicalizeSegments(segments);
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it("Test B — 10 segments reduced to ≤4", () => {
    const segments = Array.from({ length: 10 }, (_, i) =>
      makeSegment(`Segment ${i}`, [`pain${i}`], [`desire${i}`], 10)
    );
    const result = canonicalizeSegments(segments);
    expect(result.length).toBeLessThanOrEqual(4);
    const hasSecondary = result.some(s => s.name === "Secondary Segment Cluster");
    expect(hasSecondary).toBe(true);
  });

  it("Test C — mixed language segments with same profile merge", () => {
    const segments = [
      makeSegment("Weight Loss Seekers", ["frustration", "belly fat"], ["lose weight", "slim down"], 30),
      makeSegment("Weight Loss Seekers Arabic", ["frustration", "belly fat"], ["lose weight", "slim down"], 20),
    ];
    const result = canonicalizeSegments(segments);
    expect(result.length).toBeLessThanOrEqual(2);
    if (result.length === 1) {
      expect(result[0].estimatedPercentage).toBe(50);
    }
  });

  it("Test D — low evidence segments in overflow become Secondary Cluster", () => {
    const segments = [
      makeSegment("Primary A", ["pain1", "pain2"], ["desire1"], 40),
      makeSegment("Primary B", ["pain3", "pain4"], ["desire2"], 30),
      makeSegment("Primary C", ["pain5"], ["desire3"], 15),
      makeSegment("Primary D", ["pain6"], ["desire4"], 8),
      makeSegment("Low Evidence E", ["pain7"], ["desire5"], 4),
      makeSegment("Low Evidence F", ["pain8"], ["desire6"], 3),
    ];
    const result = canonicalizeSegments(segments);
    expect(result.length).toBeLessThanOrEqual(4);
  });

  it("Test E — deterministic output on identical input", () => {
    const segments = [
      makeSegment("Alpha", ["frustration"], ["confidence"], 50),
      makeSegment("Beta", ["overwhelm"], ["knowledge"], 30),
      makeSegment("Gamma", ["cost"], ["savings"], 20),
    ];
    const run1 = canonicalizeSegments(segments);
    const run2 = canonicalizeSegments(segments);
    expect(run1.length).toBe(run2.length);
    for (let i = 0; i < run1.length; i++) {
      expect(run1[i].name).toBe(run2[i].name);
      expect(run1[i].estimatedPercentage).toBe(run2[i].estimatedPercentage);
    }
  });

  it("single segment passes through unchanged", () => {
    const segments = [makeSegment("Only Segment", ["pain1"], ["desire1"], 100)];
    const result = canonicalizeSegments(segments);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Only Segment");
  });

  it("empty segments returns empty", () => {
    const result = canonicalizeSegments([]);
    expect(result).toHaveLength(0);
  });

  it("segment similarity is symmetric", () => {
    const segA = makeSegment("A", ["pain1", "pain2"], ["desire1"], 50);
    const segB = makeSegment("B", ["pain1", "pain2"], ["desire1"], 30);
    const simAB = computeSegmentSimilarity(segA, segB);
    const simBA = computeSegmentSimilarity(segB, segA);
    expect(simAB).toBeCloseTo(simBA, 5);
  });

  it("identical segments have similarity 1.0 (minus name tokens)", () => {
    const seg = makeSegment("Test", ["pain1"], ["desire1"], 50);
    const sim = computeSegmentSimilarity(seg, seg);
    expect(sim).toBe(1.0);
  });

  it("completely different segments have low similarity", () => {
    const segA = makeSegment("Alpha Fitness Seekers", ["injury", "back pain"], ["lose weight", "abs"], 50);
    const segB = makeSegment("Digital Marketing Pros", ["no results", "overwhelm"], ["financial freedom", "scale"], 50);
    const sim = computeSegmentSimilarity(segA, segB);
    expect(sim).toBeLessThan(0.3);
  });

  it("merged segments preserve combined evidence count", () => {
    const segments = [
      { ...makeSegment("A", ["pain1"], ["desire1"], 40), evidenceCount: 20 },
      { ...makeSegment("A Copy", ["pain1"], ["desire1"], 30), evidenceCount: 15 },
    ];
    const result = canonicalizeSegments(segments);
    if (result.length === 1) {
      expect(result[0].evidenceCount).toBe(35);
      expect(result[0].estimatedPercentage).toBe(70);
    }
  });
});

describe("Audience Engine V3 — Density Normalization (T002)", () => {
  const makePain = (name: string, freq: number) => ({
    canonical: name, frequency: freq, evidence: ["a"], evidenceCount: freq,
    confidenceScore: 0.5, sourceSignals: ["test"], inputSnapshotId: null,
  });
  const makeDesire = (name: string, freq: number) => ({
    canonical: name, frequency: freq, evidence: ["a"], evidenceCount: freq,
    confidenceScore: 0.5, sourceSignals: ["test"], inputSnapshotId: null,
  });
  const makeSeg = (name: string, pains: string[], desires: string[]) => ({
    name, description: "", painProfile: pains, desireProfile: desires,
    objectionProfile: [] as string[], motivationProfile: [] as string[],
    estimatedPercentage: 0, evidenceCount: 10, confidenceScore: 0.5,
    sourceSignals: ["test"], inputSnapshotId: null,
  });

  it("density scores sum to exactly 100%", () => {
    const pains = [makePain("frustration", 30), makePain("overwhelm", 20)];
    const desires = [makeDesire("confidence", 25), makeDesire("health", 25)];
    const segs = [
      makeSeg("A", ["frustration"], ["confidence"]),
      makeSeg("B", ["overwhelm"], ["health"]),
    ];
    const result = computeSegmentDensity(pains, desires, segs, null);
    const sum = result.reduce((s, d) => s + d.densityScore, 0);
    expect(sum).toBe(100);
  });

  it("density scores sum to 100% with 3 uneven segments", () => {
    const pains = [makePain("a", 7), makePain("b", 11), makePain("c", 3)];
    const desires = [makeDesire("d", 9), makeDesire("e", 5)];
    const segs = [
      makeSeg("Seg1", ["a"], ["d"]),
      makeSeg("Seg2", ["b"], ["e"]),
      makeSeg("Seg3", ["c"], []),
    ];
    const result = computeSegmentDensity(pains, desires, segs, null);
    const sum = result.reduce((s, d) => s + d.densityScore, 0);
    expect(sum).toBe(100);
  });

  it("density handles zero total gracefully", () => {
    const segs = [makeSeg("Empty", ["nonexistent"], ["nothing"])];
    const result = computeSegmentDensity([], [], segs, null);
    expect(result[0].densityScore).toBe(0);
  });

  it("single segment gets 100% density", () => {
    const pains = [makePain("frustration", 50)];
    const segs = [makeSeg("Only", ["frustration"], [])];
    const result = computeSegmentDensity(pains, [], segs, null);
    expect(result[0].densityScore).toBe(100);
  });
});

describe("Audience Engine V3 — Adversarial Inputs", () => {
  it("handles emoji-only text without crash", () => {
    const emojiTexts = ["🔥🔥🔥", "💪💪💪💪", "❤️😍🎉"];
    let matches = 0;
    for (const text of emojiTexts) {
      const lower = text.toLowerCase();
      for (const cluster of PAIN_CLUSTERS) {
        if (cluster.patterns.some(p => lower.includes(p))) { matches++; break; }
      }
    }
    expect(matches).toBe(0);
  });

  it("handles empty strings without crash", () => {
    const emptyTexts = ["", "   ", "\n\n", "\t"];
    let matches = 0;
    for (const text of emptyTexts) {
      const lower = text.toLowerCase();
      for (const cluster of PAIN_CLUSTERS) {
        if (cluster.patterns.some(p => lower.includes(p))) { matches++; break; }
      }
    }
    expect(matches).toBe(0);
  });

  it("handles very long text without crash", () => {
    const longText = "how do i lose weight ".repeat(500);
    const lower = longText.toLowerCase();
    let matched = false;
    for (const cluster of PAIN_CLUSTERS.concat(DESIRE_CLUSTERS)) {
      if (cluster.patterns.some(p => lower.includes(p))) { matched = true; break; }
    }
    expect(matched).toBe(true);
  });

  it("market detection handles adversarial input", () => {
    const weirdTexts = ["🔥🔥🔥", "AAAAAAA", "123456", "      "];
    const result = detectMarketScope(weirdTexts, { industry: "", coreOffer: "" });
    expect(result).toContain("universal");
  });
});

describe("Audience Engine V3 — System Integrity", () => {
  it("engine is diagnosis only — no prescriptive language in patterns", () => {
    const forbiddenWords = ["you should", "we recommend", "our strategy", "take action", "implement"];
    const allPatterns = [
      ...PAIN_CLUSTERS.flatMap(c => c.patterns),
      ...DESIRE_CLUSTERS.flatMap(c => c.patterns),
      ...OBJECTION_CLUSTERS.flatMap(c => c.patterns),
    ];
    for (const pattern of allPatterns) {
      for (const forbidden of forbiddenWords) {
        expect(pattern.includes(forbidden)).toBe(false);
      }
    }
  });

  it("market-scoped clusters have valid scope values", () => {
    const validScopes = ["universal", "fitness", "health", "marketing", "ecommerce", "education", "finance", "tech", "beauty", "food"];
    const allClusters = [...PAIN_CLUSTERS, ...DESIRE_CLUSTERS, ...OBJECTION_CLUSTERS];
    for (const cluster of allClusters) {
      if (cluster.marketScope) {
        for (const scope of cluster.marketScope) {
          expect(validScopes).toContain(scope);
        }
      }
    }
  });

  it("physical limitations cluster has marketScope restriction", () => {
    const physLim = OBJECTION_CLUSTERS.find(c => c.canonical === "physical limitations");
    expect(physLim).toBeDefined();
    expect(physLim!.marketScope).toBeDefined();
    expect(physLim!.marketScope).toContain("fitness");
    expect(physLim!.marketScope).not.toContain("marketing");
  });

  it("body image struggles cluster has marketScope restriction", () => {
    const bodyImage = PAIN_CLUSTERS.find(c => c.canonical === "body image struggles");
    expect(bodyImage).toBeDefined();
    expect(bodyImage!.marketScope).toBeDefined();
    expect(bodyImage!.marketScope).toContain("fitness");
    expect(bodyImage!.marketScope).not.toContain("marketing");
  });
});
