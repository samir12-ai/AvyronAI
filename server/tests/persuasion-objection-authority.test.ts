import { describe, it, expect } from "vitest";
import "dotenv/config";
import { buildReasonedStructuredObjections } from "../persuasion-engine/engine";
import { getExecutableCoreLanes } from "../shared/executable-lanes";

describe("Persuasion Objection Authority Tests", () => {
  const baseAudience = {
    painProfiles: [{ pain: "Manual bottleneck", painId: "seg_1_pain_1", classification: "CORE_PURCHASE" }],
    audiencePains: [{ pain: "Manual bottleneck", painId: "seg_1_pain_1", classification: "CORE_PURCHASE" }],
    painRegistry: [
      { painId: "seg_1_pain_1", canonical: "Manual bottleneck", classification: "CORE_PURCHASE" },
      { painId: "seg_2_pain_1", canonical: "Fragmented visibility", classification: "CORE_PURCHASE" },
    ],
    objectionMap: {
      "lack of support": { label: "lack of support", canonical: "lack of support", response: "Dedicated support team" },
      "fear of commitment": { label: "fear of commitment", canonical: "fear of commitment", response: "Flexible contracts" },
      "industry lacks transparency": { label: "industry lacks transparency", canonical: "industry lacks transparency", response: "Audit trails" },
    },
    emotionalDrivers: ["confidence", "efficiency"],
    audienceSegments: [{ id: "seg_1", name: "Operations Lead" }],
  };

  const baseStrategic = {
    strategyRoot: {
      approvedMechanism: "Live Market Mirror & Semantic Judge",
      brandSpine: { primaryAxis: "continuous evidence", contrastAxis: "static analysis" },
    },
    doctrine: {
      resolution: "anchored",
      productAnchor: {
        name: "Avyron AI",
        type: "AI Platform",
        offeringType: "SaaS",
        problemSolved: "Manual bottleneck",
        uniqueMechanism: "Live Market Mirror & Semantic Judge",
        strategicAdvantage: "Live streaming evidence",
        alternativeReplaced: "Static manual tools",
        keyAttributes: ["Live streaming", "Semantic Judge"],
        coreProblemSolved: "Manual bottleneck",
        differentiatingFeature: "Continuous Live Market Mirror & Semantic Judge",
        productSpecs: ["Real-time streaming"],
        customerUseCases: ["Workflow automation"],
      },
    },
    priorDecisions: [],
  };

  it("TEST 1: Main structured objection output includes lane objections A/B as primary", async () => {
    const laneContext = {
      laneId: "lane_workflow",
      title: "Workflow Automation",
      primaryPainId: "seg_1_pain_1",
      corePainIds: ["seg_1_pain_1"],
      objections: [
        "Concerns about AI integration complexity",
        "Skepticism about automation accuracy and reliability",
      ],
    };

    const structured = await buildReasonedStructuredObjections(
      baseAudience as any,
      { marketDiagnosis: "GROWING", opportunitySignals: [], threatSignals: [] } as any,
      { positioningStatement: "Avyron AI provides continuous streaming intelligence", narrativeDirection: "Proof-led", enemyDefinition: "Static tools" } as any,
      { pillars: ["Semantic Judge"], claimStructures: ["Evidence-backed"] } as any,
      { coreOutcome: "Automate manual tasks", mechanismDescription: "Live Market Mirror" } as any,
      { targetReadinessStage: "problem_aware", trustRequirement: "medium" } as any,
      { ...baseStrategic, laneId: "lane_workflow", laneContext } as any,
      null,
      null,
      "test-account",
    );

    expect(structured.length).toBeGreaterThanOrEqual(2);
    const statements = structured.map(s => s.objectionStatement);
    expect(statements).toContain("Concerns about AI integration complexity");
    expect(statements).toContain("Skepticism about automation accuracy and reliability");

    const laneSources = structured.filter(s => s.source === "lane_objection");
    expect(laneSources.length).toBe(2);
  }, 20000);

  it("TEST 2: Global objections remain available as secondary supporting context when lane has no objections", async () => {
    const laneWithoutObjections = {
      laneId: "lane_empty_objs",
      title: "Generic Lane",
      primaryPainId: "seg_1_pain_1",
      corePainIds: ["seg_1_pain_1"],
      objections: [],
    };

    const structured = await buildReasonedStructuredObjections(
      baseAudience as any,
      { marketDiagnosis: "GROWING", opportunitySignals: [], threatSignals: [] } as any,
      { positioningStatement: "Avyron AI provides continuous streaming intelligence", narrativeDirection: "Proof-led", enemyDefinition: "Static tools" } as any,
      { pillars: ["Semantic Judge"], claimStructures: ["Evidence-backed"] } as any,
      { coreOutcome: "Automate manual tasks", mechanismDescription: "Live Market Mirror" } as any,
      { targetReadinessStage: "problem_aware", trustRequirement: "medium" } as any,
      { ...baseStrategic, laneId: "lane_empty_objs", laneContext: laneWithoutObjections } as any,
      null,
      null,
      "test-account",
    );

    expect(structured.length).toBeGreaterThanOrEqual(1);
    const sources = structured.map(s => s.source);
    expect(sources).toContain("audience_objection");
  }, 20000);

  it("TEST 3: System must not silently replace active lane objections with global audience objectionMap", async () => {
    const laneContext = {
      laneId: "lane_workflow",
      title: "Workflow Automation",
      primaryPainId: "seg_1_pain_1",
      corePainIds: ["seg_1_pain_1"],
      objections: ["AI adoption risk"],
    };

    const structured = await buildReasonedStructuredObjections(
      baseAudience as any,
      { marketDiagnosis: "GROWING", opportunitySignals: [], threatSignals: [] } as any,
      { positioningStatement: "Avyron AI provides continuous streaming intelligence", narrativeDirection: "Proof-led", enemyDefinition: "Static tools" } as any,
      { pillars: ["Semantic Judge"], claimStructures: ["Evidence-backed"] } as any,
      { coreOutcome: "Automate manual tasks", mechanismDescription: "Live Market Mirror" } as any,
      { targetReadinessStage: "problem_aware", trustRequirement: "medium" } as any,
      { ...baseStrategic, laneId: "lane_workflow", laneContext } as any,
      null,
      null,
      "test-account",
    );

    expect(structured[0].objectionStatement).toBe("AI adoption risk");
    expect(structured[0].source).toBe("lane_objection");
  }, 20000);

  it("TEST 4: Fallback policy cleanly handles lane with NO objections without inventing fake objections", async () => {
    const laneEmpty = {
      laneId: "lane_no_objs",
      title: "Empty Lane",
      primaryPainId: "seg_1_pain_1",
      corePainIds: ["seg_1_pain_1"],
    };

    const structured = await buildReasonedStructuredObjections(
      { ...baseAudience, objectionMap: { "fear of commitment": { label: "fear of commitment", canonical: "fear of commitment" } } } as any,
      { marketDiagnosis: "GROWING", opportunitySignals: [], threatSignals: [] } as any,
      { positioningStatement: "Avyron AI", narrativeDirection: "Proof-led", enemyDefinition: "Static tools" } as any,
      { pillars: ["Semantic Judge"], claimStructures: ["Evidence-backed"] } as any,
      { coreOutcome: "Automate manual tasks", mechanismDescription: "Live Market Mirror" } as any,
      { targetReadinessStage: "problem_aware", trustRequirement: "medium" } as any,
      { ...baseStrategic, laneId: "lane_no_objs", laneContext: laneEmpty } as any,
      null,
      null,
      "test-account",
    );

    expect(structured.length).toBeGreaterThan(0);
    expect(structured[0].objectionStatement).toBe("fear of commitment");
  }, 20000);

  it("TEST 5: No keyword blacklist introduced", () => {
    const fs = require("fs");
    const code = fs.readFileSync("server/persuasion-engine/engine.ts", "utf-8");
    expect(code).not.toContain("blacklistedObjections");
    expect(code).not.toContain("bannedWords");
    expect(code).not.toContain("blockedKeywords");
  });

  it("TEST 6: ExecutableLaneContext preserves objections and lane attributes", () => {
    const rawLanes = [
      {
        laneId: "lane_test",
        title: "Test Lane",
        primaryPainId: "seg_1_pain_1",
        corePainIds: ["seg_1_pain_1"],
        objections: ["High complexity barrier"],
        desires: ["Rapid automation"],
      }
    ];

    const exec = getExecutableCoreLanes(
      rawLanes,
      [{ painId: "seg_1_pain_1", classification: "CORE_PURCHASE" }],
      [{ id: "seg_1" }]
    );

    expect(exec.length).toBe(1);
    expect(exec[0].objections).toEqual(["High complexity barrier"]);
    expect(exec[0].desires).toEqual(["Rapid automation"]);
  });
});
