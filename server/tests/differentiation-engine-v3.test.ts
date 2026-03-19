import { describe, it, expect } from "vitest";
import {
  layer1_positioningIntakeLock,
  layer2_competitorClaimSurfaceMapping,
  layer3_claimCollisionDetection,
  layer4_proofDemandMapping,
  layer5_trustGapPrioritization,
  layer6_authorityModeSelection,
  layer7_proofAssetArchitecture,
  layer8_mechanismConstruction,
  layer9_differentiationPillarScoring,
  layer10_claimStrengthScoring,
  layer12_stabilityGuard,
  sanitizeGuardrail,
  compressDifferentiationPillars,
  inferBusinessCategory,
  buildStructuredAELBlock,
} from "../differentiation-engine/engine";
import {
  COLLISION_THRESHOLD,
  STABILITY_MIN_PROOFABILITY,
  STABILITY_MIN_TRUST_ALIGNMENT,
} from "../differentiation-engine/constants";

const makePositioning = (overrides: any = {}) => ({
  territories: [
    { name: "Strategic Fitness Coaching", opportunityScore: 0.8, confidenceScore: 0.75, category: "niche", description: "Specialized coaching" },
    { name: "Data-Driven Nutrition", opportunityScore: 0.6, confidenceScore: 0.65, description: "Evidence-based nutrition" },
  ],
  differentiationVector: null,
  enemyDefinition: "generic trainers",
  contrastAxis: "personalized vs generic",
  narrativeDirection: "precision health",
  flankingMode: false,
  stabilityResult: { isStable: true, checks: [] },
  strategyCards: [],
  ...overrides,
});

const makeMI = (overrides: any = {}) => ({
  dominanceData: JSON.stringify([{ competitorId: "c1", dominanceScore: 0.5 }]),
  contentDnaData: JSON.stringify({
    competitors: [{
      competitorId: "c1",
      hooks: ["Transform your body in 30 days"],
      narratives: ["Science-backed fitness approach"],
      positioning: "Premium fitness solutions",
    }],
  }),
  marketDiagnosis: "Competitive fitness market with fragmented positioning",
  opportunitySignals: [],
  threatSignals: [],
  narrativeSynthesis: null,
  ...overrides,
});

const makeAudience = (overrides: any = {}) => ({
  objectionMap: {
    "too expensive": { severity: 0.8, frequency: 0.7 },
    "no time": { severity: 0.6, frequency: 0.5 },
    "already tried": { severity: 0.4, frequency: 0.3 },
  },
  emotionalDrivers: [{ driver: "confidence", strength: 0.8 }],
  maturityIndex: 0.5,
  awarenessLevel: "solution_aware",
  audiencePains: ["weight management", "energy levels"],
  desireMap: { "weight loss": 0.8, "muscle gain": 0.6 },
  audienceSegments: [],
  intentDistribution: null,
  ...overrides,
});

describe("Differentiation Engine V3", () => {
  describe("Layer 1: Positioning Intake Lock", () => {
    it("should pass with valid positioning", () => {
      const result = layer1_positioningIntakeLock(makePositioning());
      expect(result.valid).toBe(true);
      expect(result.territories.length).toBe(2);
      expect(result.failures).toHaveLength(0);
    });

    it("should fail with no territories", () => {
      const result = layer1_positioningIntakeLock(makePositioning({ territories: [] }));
      expect(result.valid).toBe(false);
      expect(result.failures.length).toBeGreaterThan(0);
    });

    it("should fail with no stability result", () => {
      const result = layer1_positioningIntakeLock(makePositioning({ stabilityResult: null }));
      expect(result.valid).toBe(false);
      expect(result.failures).toContain("Positioning stability result missing");
    });

    it("should reject territories with empty names", () => {
      const result = layer1_positioningIntakeLock(makePositioning({
        territories: [{ name: "", opportunityScore: 0.5 }, { name: "  ", opportunityScore: 0.5 }],
      }));
      expect(result.territories).toHaveLength(0);
    });
  });

  describe("Layer 2: Competitor Claim Surface Mapping", () => {
    it("should extract claims from MI content DNA", () => {
      const claims = layer2_competitorClaimSurfaceMapping(makeMI());
      expect(claims.length).toBeGreaterThan(0);
      expect(claims.some(c => c.source === "hook")).toBe(true);
      expect(claims.some(c => c.source === "narrative")).toBe(true);
      expect(claims.some(c => c.source === "positioning")).toBe(true);
    });

    it("should handle empty content DNA", () => {
      const claims = layer2_competitorClaimSurfaceMapping(makeMI({ contentDnaData: null }));
      expect(claims.some(c => c.source === "market_diagnosis")).toBe(true);
    });

    it("should extract market diagnosis as claim", () => {
      const claims = layer2_competitorClaimSurfaceMapping(makeMI());
      expect(claims.some(c => c.source === "market_diagnosis")).toBe(true);
    });
  });

  describe("Layer 3: Claim Collision Detection", () => {
    it("should detect similar claims", () => {
      const competitorClaims = [
        { claim: "Transform your body fitness coaching", source: "hook", category: "messaging", strength: 0.8 },
      ];
      const collisions = layer3_claimCollisionDetection(
        ["Transform your body with fitness coaching"],
        competitorClaims,
      );
      expect(collisions.length).toBeGreaterThan(0);
      expect(collisions[0].collisionRisk).toBeGreaterThan(0);
    });

    it("should not flag unrelated claims", () => {
      const competitorClaims = [
        { claim: "Luxury spa treatments", source: "hook", category: "messaging", strength: 0.5 },
      ];
      const collisions = layer3_claimCollisionDetection(
        ["Data-driven nutrition protocols"],
        competitorClaims,
      );
      const highCollisions = collisions.filter(c => c.collisionRisk > 0.5);
      expect(highCollisions.length).toBe(0);
    });
  });

  describe("Layer 4: Proof Demand Mapping", () => {
    it("should generate proof demands from audience signals", () => {
      const demands = layer4_proofDemandMapping(makeAudience(), makePositioning().territories);
      expect(demands.length).toBeGreaterThan(0);
      expect(demands.some(d => d.category === "outcome_proof")).toBe(true);
    });

    it("should prioritize transparency proof when objections exist", () => {
      const demands = layer4_proofDemandMapping(makeAudience(), makePositioning().territories);
      expect(demands.some(d => d.category === "transparency_proof")).toBe(true);
    });

    it("should add comparative proof for high-maturity audiences", () => {
      const demands = layer4_proofDemandMapping(
        makeAudience({ maturityIndex: 0.8, awarenessLevel: "product_aware" }),
        makePositioning().territories,
      );
      expect(demands.some(d => d.category === "comparative_proof")).toBe(true);
    });

    it("should sort demands by priority", () => {
      const demands = layer4_proofDemandMapping(makeAudience(), makePositioning().territories);
      for (let i = 1; i < demands.length; i++) {
        expect(demands[i - 1].priority).toBeGreaterThanOrEqual(demands[i].priority);
      }
    });
  });

  describe("Layer 5: Trust Gap Prioritization", () => {
    it("should rank trust gaps from audience objections", () => {
      const gaps = layer5_trustGapPrioritization(makeAudience(), makePositioning().territories);
      expect(gaps.length).toBe(3);
      expect(gaps[0].priorityRank).toBe(1);
      expect(gaps[1].priorityRank).toBe(2);
    });

    it("should handle empty objections", () => {
      const gaps = layer5_trustGapPrioritization(makeAudience({ objectionMap: {} }), makePositioning().territories);
      expect(gaps).toHaveLength(0);
    });

    it("should clamp severity between 0 and 1", () => {
      const gaps = layer5_trustGapPrioritization(
        makeAudience({ objectionMap: { test: { severity: 1.5 } } }),
        makePositioning().territories,
      );
      expect(gaps[0].severity).toBeLessThanOrEqual(1);
    });
  });

  describe("Layer 6: Authority Mode Selection", () => {
    it("should select contrarian for flanking mode with strong competitors", () => {
      const result = layer6_authorityModeSelection(
        makePositioning({ flankingMode: true }),
        makeAudience(),
        makeMI({ dominanceData: JSON.stringify([{ dominanceScore: 0.9 }]) }),
      );
      expect(result.mode).toBe("contrarian_specialist");
    });

    it("should select expert for high-maturity, high-awareness", () => {
      const result = layer6_authorityModeSelection(
        makePositioning(),
        makeAudience({ maturityIndex: 0.8, awarenessLevel: "most_aware" }),
        makeMI(),
      );
      expect(result.mode).toBe("expert");
    });

    it("should select transparent_guide for low maturity", () => {
      const result = layer6_authorityModeSelection(
        makePositioning(),
        makeAudience({ maturityIndex: 0.2 }),
        makeMI(),
      );
      expect(result.mode).toBe("transparent_guide");
    });

    it("should select operator for solution-aware audience", () => {
      const result = layer6_authorityModeSelection(
        makePositioning({ territories: [{ name: "general", opportunityScore: 0.5 }] }),
        makeAudience({ maturityIndex: 0.5, awarenessLevel: "solution_aware" }),
        makeMI({ dominanceData: JSON.stringify([{ dominanceScore: 0.3 }]) }),
      );
      expect(result.mode).toBe("operator");
    });
  });

  describe("Layer 7: Proof Asset Architecture", () => {
    it("should generate proof assets from demands and gaps", () => {
      const demands = layer4_proofDemandMapping(makeAudience(), makePositioning().territories);
      const gaps = layer5_trustGapPrioritization(makeAudience(), makePositioning().territories);
      const assets = layer7_proofAssetArchitecture(demands, gaps, makePositioning().territories);
      expect(assets.length).toBeGreaterThan(0);
      expect(assets[0].impactScore).toBeGreaterThan(0);
    });

    it("should sort by impact score", () => {
      const demands = layer4_proofDemandMapping(makeAudience(), makePositioning().territories);
      const gaps = layer5_trustGapPrioritization(makeAudience(), makePositioning().territories);
      const assets = layer7_proofAssetArchitecture(demands, gaps, makePositioning().territories);
      for (let i = 1; i < assets.length; i++) {
        expect(assets[i - 1].impactScore).toBeGreaterThanOrEqual(assets[i].impactScore);
      }
    });
  });

  describe("Layer 8: Mechanism Construction", () => {
    it("should detect framework mechanism from proof demands", () => {
      const demands = [
        { category: "framework_proof" as const, priority: 0.8, rationale: "test", requiredFor: [] },
      ];
      const result = layer8_mechanismConstruction(makePositioning(), demands);
      expect(result.supported).toBe(true);
      expect(result.type).toBe("framework");
    });

    it("should return none when no mechanism supported", () => {
      const demands = [
        { category: "outcome_proof" as const, priority: 0.7, rationale: "test", requiredFor: [] },
      ];
      const result = layer8_mechanismConstruction(makePositioning(), demands);
      expect(result.type).toBe("none");
      expect(result.supported).toBe(false);
    });
  });

  describe("Layer 9: Differentiation Pillar Scoring", () => {
    it("should score pillars based on all dimensions", () => {
      const claims = layer2_competitorClaimSurfaceMapping(makeMI());
      const gaps = layer5_trustGapPrioritization(makeAudience(), makePositioning().territories);
      const demands = layer4_proofDemandMapping(makeAudience(), makePositioning().territories);
      const pillars = layer9_differentiationPillarScoring(
        makePositioning().territories, claims, gaps, demands, makeAudience(),
      );
      expect(pillars.length).toBe(2);
      expect(pillars[0].overallScore).toBeGreaterThanOrEqual(pillars[1].overallScore);
      expect(pillars[0].uniqueness).toBeGreaterThanOrEqual(0);
      expect(pillars[0].uniqueness).toBeLessThanOrEqual(1);
    });

    it("should verify scoring formula: weighted sum", () => {
      const claims = layer2_competitorClaimSurfaceMapping(makeMI());
      const gaps = layer5_trustGapPrioritization(makeAudience(), makePositioning().territories);
      const demands = layer4_proofDemandMapping(makeAudience(), makePositioning().territories);
      const pillars = layer9_differentiationPillarScoring(
        makePositioning().territories, claims, gaps, demands, makeAudience(),
      );
      for (const p of pillars) {
        const expected = Math.max(0, Math.min(1,
          p.uniqueness * 0.30 + p.proofability * 0.25 + p.trustAlignment * 0.20 +
          p.positioningAlignment * 0.15 + p.objectionCoverage * 0.10,
        ));
        expect(Math.abs(p.overallScore - expected)).toBeLessThan(0.01);
      }
    });
  });

  describe("Layer 10: Claim Strength Scoring", () => {
    it("should produce claim structures from pillars", () => {
      const pillars = [
        {
          name: "Test Pillar", description: "Test", uniqueness: 0.8, proofability: 0.7,
          trustAlignment: 0.6, positioningAlignment: 0.5, objectionCoverage: 0.4,
          overallScore: 0.65, territory: "Test", supportingProof: ["case_proof"],
        },
      ];
      const claims = layer10_claimStrengthScoring(pillars, [], makePositioning().territories);
      expect(claims.length).toBe(1);
      expect(claims[0].distinctiveness).toBeGreaterThanOrEqual(0);
      expect(claims[0].overallScore).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Layer 12: Stability Guard", () => {
    it("should pass with valid configuration", () => {
      const pillars = [
        {
          name: "T1", description: "Test", uniqueness: 0.8, proofability: 0.7,
          trustAlignment: 0.6, positioningAlignment: 0.5, objectionCoverage: 0.4,
          overallScore: 0.65, territory: "T1", supportingProof: [],
        },
      ];
      const territories = [{ name: "T1", opportunityScore: 0.8 }];
      const result = layer12_stabilityGuard(pillars, [], [], territories);
      expect(result.stable).toBe(true);
      expect(result.failures).toHaveLength(0);
    });

    it("should fail if pillar references unknown territory", () => {
      const pillars = [
        {
          name: "P1", description: "Test", uniqueness: 0.8, proofability: 0.7,
          trustAlignment: 0.6, positioningAlignment: 0.5, objectionCoverage: 0.4,
          overallScore: 0.65, territory: "Unknown Territory", supportingProof: [],
        },
      ];
      const result = layer12_stabilityGuard(pillars, [], [], [{ name: "T1", opportunityScore: 0.8 }]);
      expect(result.stable).toBe(false);
      expect(result.failures.some(f => f.includes("Unknown Territory"))).toBe(true);
    });

    it("should fail on high collision risk", () => {
      const collisions = [{ candidateClaim: "test", competitorClaim: "test", similarity: 0.9, narrativeProximity: 0.8, collisionRisk: COLLISION_THRESHOLD, competitorSource: "hook" }];
      const result = layer12_stabilityGuard([], [], collisions, []);
      expect(result.stable).toBe(false);
      expect(result.failures.some(f => f.includes("collision threshold"))).toBe(true);
    });

    it("should fail on low average proofability", () => {
      const pillars = [
        {
          name: "T1", description: "Test", uniqueness: 0.8, proofability: 0.1,
          trustAlignment: 0.6, positioningAlignment: 0.5, objectionCoverage: 0.4,
          overallScore: 0.3, territory: "T1", supportingProof: [],
        },
      ];
      const result = layer12_stabilityGuard(pillars, [], [], [{ name: "T1", opportunityScore: 0.8 }]);
      expect(result.stable).toBe(false);
      expect(result.failures.some(f => f.includes("proofability"))).toBe(true);
    });

    it("should fail on low trust alignment", () => {
      const pillars = [
        {
          name: "T1", description: "Test", uniqueness: 0.8, proofability: 0.5,
          trustAlignment: 0.1, positioningAlignment: 0.5, objectionCoverage: 0.4,
          overallScore: 0.3, territory: "T1", supportingProof: [],
        },
      ];
      const result = layer12_stabilityGuard(pillars, [], [], [{ name: "T1", opportunityScore: 0.8 }]);
      expect(result.stable).toBe(false);
      expect(result.failures.some(f => f.includes("trust alignment"))).toBe(true);
    });
  });

  describe("Guardrail: No Offer Leakage", () => {
    it("should flag pricing language", () => {
      expect(sanitizeGuardrail("Set your pricing at $99/month")).toBe(true);
      expect(sanitizeGuardrail("Money-back guarantee included")).toBe(true);
      expect(sanitizeGuardrail("Free trial for 7 days")).toBe(true);
    });

    it("should flag discount/bundle language", () => {
      expect(sanitizeGuardrail("Offer a discount package")).toBe(true);
      expect(sanitizeGuardrail("Bundle with upsell")).toBe(true);
    });
  });

  describe("Guardrail: No Channel Leakage", () => {
    it("should flag social platform mentions", () => {
      expect(sanitizeGuardrail("Post on Instagram reels")).toBe(true);
      expect(sanitizeGuardrail("Create a TikTok campaign")).toBe(true);
      expect(sanitizeGuardrail("YouTube content calendar")).toBe(true);
    });

    it("should flag ad copy language", () => {
      expect(sanitizeGuardrail("Write ad copy for landing page")).toBe(true);
      expect(sanitizeGuardrail("Email sequence for nurture")).toBe(true);
    });
  });

  describe("Guardrail: No Audience Recreation", () => {
    it("should flag new segment creation", () => {
      expect(sanitizeGuardrail("Define a new segment of millennials")).toBe(true);
      expect(sanitizeGuardrail("Target demographic breakdown")).toBe(true);
    });
  });

  describe("Guardrail: Clean Text Passes", () => {
    it("should not flag legitimate differentiation language", () => {
      expect(sanitizeGuardrail("Evidence-based coaching methodology")).toBe(false);
      expect(sanitizeGuardrail("Precision health framework for transformation")).toBe(false);
      expect(sanitizeGuardrail("Data-driven approach to nutrition")).toBe(false);
    });
  });

  describe("Cross-Campaign Safety", () => {
    it("pillars reference only approved territories", () => {
      const positioning = makePositioning();
      const territoryNames = new Set(positioning.territories.map((t: any) => t.name));
      const claims = layer2_competitorClaimSurfaceMapping(makeMI());
      const gaps = layer5_trustGapPrioritization(makeAudience(), positioning.territories);
      const demands = layer4_proofDemandMapping(makeAudience(), positioning.territories);
      const pillars = layer9_differentiationPillarScoring(
        positioning.territories, claims, gaps, demands, makeAudience(),
      );
      for (const p of pillars) {
        expect(territoryNames.has(p.territory)).toBe(true);
      }
    });
  });

  describe("Full Pipeline Integration", () => {
    it("should produce stable output from valid inputs", () => {
      const positioning = makePositioning();
      const mi = makeMI();
      const audience = makeAudience();

      const l1 = layer1_positioningIntakeLock(positioning);
      expect(l1.valid).toBe(true);

      const l2 = layer2_competitorClaimSurfaceMapping(mi);
      expect(l2.length).toBeGreaterThan(0);

      const l3 = layer3_claimCollisionDetection(l1.territories.map(t => t.name), l2);
      const l4 = layer4_proofDemandMapping(audience, l1.territories);
      const l5 = layer5_trustGapPrioritization(audience, l1.territories);
      const l6 = layer6_authorityModeSelection(positioning, audience, mi);
      const l7 = layer7_proofAssetArchitecture(l4, l5, l1.territories);
      const l8 = layer8_mechanismConstruction(positioning, l4);
      const l9 = layer9_differentiationPillarScoring(l1.territories, l2, l5, l4, audience);
      const l10 = layer10_claimStrengthScoring(l9, l3, l1.territories);
      const l12 = layer12_stabilityGuard(l9, l10, l3, l1.territories);

      expect(l6.mode).toBeDefined();
      expect(l7.length).toBeGreaterThan(0);
      expect(l9.length).toBe(2);
      expect(l10.length).toBe(2);
      expect(l12.stable).toBe(true);
    });
  });

  describe("Differentiation Pillar Compression", () => {
    const makePillar = (overrides: any = {}) => ({
      name: "test pillar",
      description: "Test description",
      uniqueness: 0.5,
      proofability: 0.5,
      trustAlignment: 0.5,
      positioningAlignment: 0.5,
      objectionCoverage: 0.3,
      overallScore: 0.5,
      territory: "test territory",
      supportingProof: ["case_proof"],
      ...overrides,
    });

    it("should return single pillar unchanged", () => {
      const pillars = [makePillar({ name: "Lead Pipeline Optimization" })];
      const result = compressDifferentiationPillars(pillars);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Lead Pipeline Optimization");
    });

    it("should merge pillars with high token overlap", () => {
      const pillars = [
        makePillar({ name: "cost affordability pricing strategy", overallScore: 0.7 }),
        makePillar({ name: "cost affordability budget optimization", overallScore: 0.5 }),
        makePillar({ name: "trust authority credibility", overallScore: 0.4 }),
      ];
      const result = compressDifferentiationPillars(pillars);
      expect(result.length).toBeLessThanOrEqual(2);
      expect(result[0].name).toBe("cost affordability pricing strategy");
    });

    it("should preserve distinct pillars up to MAX_PILLARS", () => {
      const pillars = [
        makePillar({ name: "lead generation pipeline", overallScore: 0.8 }),
        makePillar({ name: "trust authority proof", overallScore: 0.6 }),
        makePillar({ name: "competitive intelligence depth", overallScore: 0.5 }),
      ];
      const result = compressDifferentiationPillars(pillars);
      expect(result).toHaveLength(3);
    });

    it("should cap output at MAX_PILLARS=3", () => {
      const pillars = [
        makePillar({ name: "alpha beta gamma", overallScore: 0.9 }),
        makePillar({ name: "delta epsilon zeta", overallScore: 0.7 }),
        makePillar({ name: "eta theta iota", overallScore: 0.5 }),
        makePillar({ name: "kappa lambda mu", overallScore: 0.3 }),
        makePillar({ name: "nu xi omicron", overallScore: 0.2 }),
      ];
      const result = compressDifferentiationPillars(pillars);
      expect(result.length).toBeLessThanOrEqual(3);
    });

    it("should penalize cross-industry generic pillar names", () => {
      const pillars = [
        makePillar({ name: "financial accessibility improvement", overallScore: 0.6 }),
        makePillar({ name: "lead pipeline automation", overallScore: 0.5 }),
      ];
      const result = compressDifferentiationPillars(pillars);
      expect(result[0].overallScore).toBeLessThan(0.6);
    });

    it("should use different overlap thresholds for service businesses", () => {
      const pillars = [
        makePillar({ name: "consulting approach methodology", overallScore: 0.7 }),
        makePillar({ name: "consulting approach framework", overallScore: 0.5 }),
      ];
      const serviceProfile = { businessType: "consulting", coreOffer: "strategy consulting", productCategory: null };
      const result = compressDifferentiationPillars(pillars, serviceProfile as any);
      expect(result.length).toBeLessThanOrEqual(2);
    });

    it("should absorb best scores from merged pillars", () => {
      const pillars = [
        makePillar({ name: "cost pricing strategy budget", overallScore: 0.5, uniqueness: 0.3, proofability: 0.4 }),
        makePillar({ name: "cost pricing approach budget", overallScore: 0.6, uniqueness: 0.8, proofability: 0.9 }),
      ];
      const result = compressDifferentiationPillars(pillars);
      expect(result).toHaveLength(1);
      expect(result[0].uniqueness).toBe(0.8);
      expect(result[0].proofability).toBe(0.9);
    });
  });

  describe("Phase 2: Prompt Hardening — inferBusinessCategory", () => {
    it("should return 'service' for consulting businesses", () => {
      expect(inferBusinessCategory({ businessType: "consulting", coreOffer: "strategy consulting" } as any)).toBe("service");
    });

    it("should return 'service' for SaaS businesses", () => {
      expect(inferBusinessCategory({ businessType: "saas", coreOffer: "marketing platform" } as any)).toBe("service");
    });

    it("should return 'service' for coaching businesses", () => {
      expect(inferBusinessCategory({ businessType: "coaching", coreOffer: "executive coaching" } as any)).toBe("service");
    });

    it("should return 'product' for ecommerce businesses", () => {
      expect(inferBusinessCategory({ businessType: "ecommerce", coreOffer: "organic skincare" } as any)).toBe("product");
    });

    it("should return 'product' for retail businesses", () => {
      expect(inferBusinessCategory({ businessType: "retail", coreOffer: "electronics" } as any)).toBe("product");
    });

    it("should return 'general' for unrecognized business types", () => {
      expect(inferBusinessCategory({ businessType: "marketplace", coreOffer: "platform" } as any)).toBe("general");
    });

    it("should return 'general' for null profile", () => {
      expect(inferBusinessCategory(null)).toBe("general");
      expect(inferBusinessCategory(undefined)).toBe("general");
    });

    it("should infer from coreOffer when businessType is generic", () => {
      expect(inferBusinessCategory({ businessType: "other", coreOffer: "dental implants" } as any)).toBe("service");
    });

    it("should infer from productCategory for ecommerce", () => {
      expect(inferBusinessCategory({ businessType: "online", coreOffer: "gadgets", productCategory: "electronics store" } as any)).toBe("product");
    });
  });

  describe("buildStructuredAELBlock — AEL Injection Strengthening", () => {
    it("should return empty string when no AEL data", () => {
      expect(buildStructuredAELBlock(null)).toBe("");
      expect(buildStructuredAELBlock({})).toBe("");
      expect(buildStructuredAELBlock({ root_causes: [], causal_chains: [], buying_barriers: [] })).toBe("");
    });

    it("should format root causes with RC identifiers", () => {
      const ael = {
        root_causes: [
          { surfaceSignal: "users complain about price", deepCause: "value proposition unclear relative to alternatives", confidenceLevel: "high" },
          { surfaceSignal: "low engagement", deepCause: "onboarding friction creates abandonment", confidenceLevel: "medium" },
        ],
        causal_chains: [],
        buying_barriers: [],
      };
      const result = buildStructuredAELBlock(ael);
      expect(result).toContain("[RC1]");
      expect(result).toContain("[RC2]");
      expect(result).toContain("value proposition unclear relative to alternatives");
      expect(result).toContain("onboarding friction creates abandonment");
      expect(result).toContain("AEL CAUSAL STRUCTURE");
    });

    it("should format causal chains with CC identifiers", () => {
      const ael = {
        root_causes: [],
        causal_chains: [
          { pain: "confusion", cause: "too many options", impact: "decision paralysis", behavior: "abandon cart", conversionEffect: "lost sale" },
        ],
        buying_barriers: [],
      };
      const result = buildStructuredAELBlock(ael);
      expect(result).toContain("[CC1]");
      expect(result).toContain("confusion");
      expect(result).toContain("too many options");
      expect(result).toContain("decision paralysis");
      expect(result).toContain("lost sale");
    });

    it("should format buying barriers with BB identifiers", () => {
      const ael = {
        root_causes: [],
        causal_chains: [],
        buying_barriers: [
          { severity: "blocking", barrier: "no proof of ROI", rootCause: "lack of case studies", requiredResolution: "publish outcome data" },
        ],
      };
      const result = buildStructuredAELBlock(ael);
      expect(result).toContain("[BB1]");
      expect(result).toContain("no proof of ROI");
      expect(result).toContain("lack of case studies");
      expect(result).toContain("publish outcome data");
    });

    it("should cap at 5 items per section", () => {
      const ael = {
        root_causes: Array.from({ length: 8 }, (_, i) => ({
          surfaceSignal: `signal ${i}`, deepCause: `cause ${i}`, confidenceLevel: "high",
        })),
        causal_chains: [],
        buying_barriers: [],
      };
      const result = buildStructuredAELBlock(ael);
      expect(result).toContain("[RC5]");
      expect(result).not.toContain("[RC6]");
    });

    it("should include all three sections when data is present", () => {
      const ael = {
        root_causes: [{ surfaceSignal: "s", deepCause: "d", confidenceLevel: "high" }],
        causal_chains: [{ pain: "p", cause: "c", impact: "i", behavior: "b", conversionEffect: "e" }],
        buying_barriers: [{ severity: "major", barrier: "b", rootCause: "r", requiredResolution: "res" }],
      };
      const result = buildStructuredAELBlock(ael);
      expect(result).toContain("ROOT CAUSES:");
      expect(result).toContain("CAUSAL CHAINS:");
      expect(result).toContain("BUYING BARRIERS:");
      expect(result).toContain("[RC1]");
      expect(result).toContain("[CC1]");
      expect(result).toContain("[BB1]");
    });
  });
});
