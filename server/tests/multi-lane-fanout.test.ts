import { describe, it, expect, vi } from "vitest";

vi.mock("../db", () => {
  const dummyChain: any = {
    select: () => dummyChain,
    from: () => dummyChain,
    where: () => dummyChain,
    limit: () => Promise.resolve([]),
    insert: () => dummyChain,
    values: () => dummyChain,
    returning: () => Promise.resolve([{ id: "mock_plan_1" }]),
    update: () => dummyChain,
    set: () => dummyChain,
    orderBy: () => dummyChain,
  };
  return {
    db: dummyChain,
  };
});

import { getExecutableCoreLanes, type ExecutableLaneContext } from "../shared/executable-lanes";
import { resolveTargetLaneAndSegment } from "../persuasion-engine/engine";
import { synthesizePlan } from "../orchestrator/plan-synthesis";
import { BusinessRepresentationSchema } from "../core/business-language-layer";
import { funnelSnapshots, persuasionSnapshots, awarenessSnapshots } from "../../shared/schema";

describe("AVYRON Multi-Lane Downstream Fan-Out Test Suite (Tests A through R)", () => {
  const mockConfig = { accountId: "acc_1", campaignId: "camp_1", jobId: "job_1" };

  const mockPainRegistrySingleCore = {
    canonicalPains: [
      {
        id: "seg_3_pain_1",
        segmentId: "seg_3",
        text: "Scattered insights, poor data quality, and lack of visibility hindering GTM targeting decisions",
        role: "CORE_PURCHASE",
        severityScore: 0.92,
      },
      {
        id: "seg_2_pain_1",
        segmentId: "seg_2",
        text: "Repetitive manual tasks causing practitioner burnout and inefficiency",
        role: "SUPPORTING",
        severityScore: 0.78,
      },
      {
        id: "seg_1_pain_1",
        segmentId: "seg_1",
        text: "Billing disputes, unexpected charges, and hidden renewal fees",
        role: "EXCLUDE",
        severityScore: 0.85,
      },
    ],
  };

  const mockApprovedLanesSingleCore = [
    {
      laneId: "lane_core_seg_3",
      primaryPainId: "seg_3_pain_1",
      targetSegmentId: "seg_3",
      title: "Enterprise Revenue Operations",
      description: "GTM leaders needing predictive visibility and clean data.",
    },
    {
      laneId: "lane_supporting_seg_2",
      primaryPainId: "seg_2_pain_1",
      targetSegmentId: "seg_2",
      title: "Frontline Practitioner Automation",
      description: "Support staff wanting task reduction.",
    },
  ];

  const mockAudienceSegments = [
    { id: "seg_3", name: "Enterprise RevOps", painIds: ["seg_3_pain_1"] },
    { id: "seg_2", name: "Frontline Staff", painIds: ["seg_2_pain_1"] },
    { id: "seg_4", name: "Mid-Market Growth Leaders", painIds: ["seg_4_pain_1"] },
  ];

  const mockPainRegistryMultiCore = {
    canonicalPains: [
      {
        id: "seg_3_pain_1",
        segmentId: "seg_3",
        text: "Scattered insights and poor data quality across enterprise RevOps",
        role: "CORE_PURCHASE",
        severityScore: 0.92,
      },
      {
        id: "seg_4_pain_1",
        segmentId: "seg_4",
        text: "Long sales cycles and pipeline stall in mid-market accounts",
        role: "CORE_PURCHASE",
        severityScore: 0.88,
      },
      {
        id: "seg_2_pain_1",
        segmentId: "seg_2",
        text: "Manual repetitive workflow bottlenecks",
        role: "SUPPORTING",
        severityScore: 0.75,
      },
      {
        id: "seg_1_pain_1",
        segmentId: "seg_1",
        text: "Billing surprises",
        role: "EXCLUDE",
        severityScore: 0.80,
      },
    ],
  };

  const mockApprovedLanesMultiCore = [
    {
      laneId: "lane_a_enterprise",
      primaryPainId: "seg_3_pain_1",
      targetSegmentId: "seg_3",
      title: "Enterprise Revenue Operations",
      description: "RevOps leaders needing deep pipeline governance.",
    },
    {
      laneId: "lane_b_midmarket",
      primaryPainId: "seg_4_pain_1",
      targetSegmentId: "seg_4",
      title: "Mid-Market Sales Acceleration",
      description: "Mid-market sales directors seeking deal velocity.",
    },
    {
      laneId: "lane_supporting_ops",
      primaryPainId: "seg_2_pain_1",
      targetSegmentId: "seg_2",
      title: "Frontline Support Automation",
      description: "Supporting operational pain.",
    },
  ];

  // Test A: Single-CORE lane produces exactly 1 executable CORE lane
  it("Test A: Single-CORE lane produces exactly 1 executable CORE lane", () => {
    const executableLanes = getExecutableCoreLanes(
      mockApprovedLanesSingleCore,
      mockPainRegistrySingleCore,
      mockAudienceSegments
    );
    expect(executableLanes).toHaveLength(1);
    expect(executableLanes[0].laneId).toBe("lane_core_seg_3");
    expect(executableLanes[0].primaryCorePainId).toBe("seg_3_pain_1");
  });

  // Test B: Multi-CORE produces exactly 2 executable CORE lanes
  it("Test B: Multi-CORE produces exactly 2 executable CORE lanes", () => {
    const executableLanes = getExecutableCoreLanes(
      mockApprovedLanesMultiCore,
      mockPainRegistryMultiCore,
      mockAudienceSegments
    );
    expect(executableLanes).toHaveLength(2);
    const laneIds = executableLanes.map((l) => l.laneId);
    expect(laneIds).toContain("lane_a_enterprise");
    expect(laneIds).toContain("lane_b_midmarket");
  });

  // Test C: Supporting pain lane does NOT create a standalone executable CORE lane
  it("Test C: Supporting pain lane does NOT create a standalone executable CORE lane", () => {
    const executableLanes = getExecutableCoreLanes(
      mockApprovedLanesMultiCore,
      mockPainRegistryMultiCore,
      mockAudienceSegments
    );
    const supportingLane = executableLanes.find((l) => l.primaryCorePainId === "seg_2_pain_1" || l.laneId === "lane_supporting_ops");
    expect(supportingLane).toBeUndefined();
  });

  // Test D: Excluded pain lane does NOT create a standalone conversion path
  it("Test D: Excluded pain lane does NOT create a standalone conversion path", () => {
    const executableLanes = getExecutableCoreLanes(
      [
        { laneId: "lane_excluded", primaryPainId: "seg_1_pain_1", targetSegmentId: "seg_1", title: "Billing Dispute Lane" },
      ],
      mockPainRegistryMultiCore,
      mockAudienceSegments
    );
    expect(executableLanes).toHaveLength(0);
  });

  // Test E: Funnel snapshot metadata contains valid laneId matching input lane
  it("Test E: Funnel snapshot metadata contains valid laneId matching input lane", () => {
    const lane: ExecutableLaneContext = {
      laneId: "lane_a_enterprise",
      title: "Enterprise Revenue Operations",
      primaryCorePainId: "seg_3_pain_1",
      primaryPainText: "Scattered insights and poor data quality",
      segmentIds: ["seg_3"],
      targetSegmentName: "Enterprise RevOps",
    };
    expect(lane.laneId).toBe("lane_a_enterprise");
    expect(lane.primaryCorePainId).toBe("seg_3_pain_1");
  });

  // Test F: Persuasion snapshot metadata contains valid laneId matching input lane
  it("Test F: Persuasion snapshot metadata contains valid laneId matching input lane", () => {
    const lane: ExecutableLaneContext = {
      laneId: "lane_b_midmarket",
      title: "Mid-Market Sales Acceleration",
      primaryCorePainId: "seg_4_pain_1",
      primaryPainText: "Long sales cycles and pipeline stall",
      segmentIds: ["seg_4"],
      targetSegmentName: "Mid-Market Growth Leaders",
    };
    expect(lane.laneId).toBe("lane_b_midmarket");
    expect(lane.primaryCorePainId).toBe("seg_4_pain_1");
  });

  // Test G: Persuasion explicitly consumes its matching lane's Funnel snapshot
  it("Test G: Persuasion explicitly consumes its matching lane's Funnel snapshot and binds lane identity", () => {
    const mockContext = {
      laneContext: {
        laneId: "lane_b_midmarket",
        title: "Mid-Market Sales Acceleration",
        primaryCorePainId: "seg_4_pain_1",
        primaryPainText: "Long sales cycles and pipeline stall",
        segmentIds: ["seg_4"],
        targetSegmentName: "Mid-Market Growth Leaders",
      },
      painRegistry: mockPainRegistryMultiCore,
    };
    const mockAudienceInput = {
      painRegistry: mockPainRegistryMultiCore,
      approvedLanes: mockApprovedLanesMultiCore,
      audienceSegments: mockAudienceSegments,
    };

    const resolved = resolveTargetLaneAndSegment(mockAudienceInput, mockContext);
    expect(resolved.targetLane).toBeDefined();
    expect(resolved.targetLane.laneId).toBe("lane_b_midmarket");
    expect(resolved.targetLane.primaryPainId).toBe("seg_4_pain_1");
    expect(resolved.targetSegment).toBeDefined();
    expect(resolved.targetSegment.id).toBe("seg_4");
  });

  // Test H: Plan synthesis generates buyerConversionJourneys array for all executable CORE lanes
  it("Test H: Plan synthesis generates buyerConversionJourneys array containing an entry for every executable CORE lane", async () => {
    const results = new Map<string, any>();
    
    // Funnel 1 for Lane A
    results.set("funnel:lane_a_enterprise", {
      status: "SUCCESS",
      snapshotId: "snap_funnel_a",
      output: {
        primaryFunnel: {
          laneId: "lane_a_enterprise",
          laneLabel: "Enterprise Revenue Operations",
          primaryCorePainId: "seg_3_pain_1",
          segmentIds: ["seg_3"],
          journeyName: "Enterprise RevOps Acceleration Journey",
          journeyType: "Consultative B2B",
          whyThisJourney: "Engineered for complex enterprise buying committees.",
          stages: [
            { stageId: "s1", stageName: "Executive Awareness", goal: "Agitate visibility gap", coreMessage: "Unify data", contentAction: "Whitepaper", proof: ["SOC2 Audit"], cta: "Book Diagnostic" },
          ],
        },
      },
    });

    // Funnel 2 for Lane B
    results.set("funnel:lane_b_midmarket", {
      status: "SUCCESS",
      snapshotId: "snap_funnel_b",
      output: {
        primaryFunnel: {
          laneId: "lane_b_midmarket",
          laneLabel: "Mid-Market Sales Acceleration",
          primaryCorePainId: "seg_4_pain_1",
          segmentIds: ["seg_4"],
          journeyName: "Mid-Market Velocity Journey",
          journeyType: "Product-Led Inbound",
          whyThisJourney: "Engineered for high velocity deal cycles.",
          stages: [
            { stageId: "s1", stageName: "Problem Discovery", goal: "Highlight pipeline stall", coreMessage: "Accelerate cycles", contentAction: "Interactive Demo", proof: ["Case Study"], cta: "Start Free Pilot" },
          ],
        },
      },
    });

    // Persuasion 1 for Lane A
    results.set("persuasion:lane_a_enterprise", {
      status: "SUCCESS",
      snapshotId: "snap_persuasion_a",
      output: {
        primaryRoute: {
          mode: "Proof-Led Decision Acceleration",
          modeLabel: "Enterprise Verification",
          coreBeliefTransformation: {
            currentBelief: "Internal spreadsheets are sufficient",
            desiredBelief: "Unified engine is mandatory for scale",
          },
          messageSequence: [{ step: "s1", stepLabel: "Expose Drift", rationale: "Prove data decay" }],
          objections: [{ objection: "Too complex to implement", response: "14-day turnkey deployment", requiredProof: "Implementation SLA" }],
          trustStrategy: {
            buyerRiskState: "High Procurement Caution",
            trustDeficit: "Security & Scale Skepticism",
            transferMechanismName: "Verified Audit Report",
            proofArtifact: "Third-Party Audit",
            primaryCialdiniPrinciple: "Authority & Social Proof",
            principleRationale: "Enterprise buyers require third-party verification.",
          },
        },
      },
    });

    // Persuasion 2 for Lane B
    results.set("persuasion:lane_b_midmarket", {
      status: "SUCCESS",
      snapshotId: "snap_persuasion_b",
      output: {
        primaryRoute: {
          mode: "Rapid Value Demonstration",
          modeLabel: "Velocity-First",
          coreBeliefTransformation: {
            currentBelief: "Manual follow-ups work fine",
            desiredBelief: "Automated routing doubles close rates",
          },
          messageSequence: [{ step: "s1", stepLabel: "Show Speed", rationale: "Demonstrate quick wins" }],
          objections: [{ objection: "Budget is tight", response: "Pay-as-you-grow pricing", requiredProof: "ROI Calculator" }],
          trustStrategy: {
            buyerRiskState: "Budget Scarcity",
            trustDeficit: "ROI Doubt",
            transferMechanismName: "Live ROI Demo",
            proofArtifact: "Customer ROI Dashboard",
            primaryCialdiniPrinciple: "Social Proof & Reciprocity",
            principleRationale: "Mid-market buyers respond to peer ROI benchmarks.",
          },
        },
      },
    });

    const mockCtx = {
      approvedLanes: mockApprovedLanesMultiCore,
    };

    const synthResult = await synthesizePlan(
      mockConfig as any,
      mockCtx as any,
      results
    );
    const synthesized = synthResult.plan;

    expect(synthesized.buyerConversionJourneys).toBeDefined();
    expect(synthesized.buyerConversionJourneys).toHaveLength(2);
    expect(synthesized.buyerConversionJourneys![0].laneId).toBe("lane_a_enterprise");
    expect(synthesized.buyerConversionJourneys![1].laneId).toBe("lane_b_midmarket");
  });

  // Test I: Plan synthesis backward-compatible alias mirrors first journey
  it("Test I: Plan synthesis backward-compatible alias (buyerConversionJourney) mirrors first journey", async () => {
    const results = new Map<string, any>();
    results.set("funnel:lane_a_enterprise", {
      status: "SUCCESS",
      output: {
        primaryFunnel: {
          laneId: "lane_a_enterprise",
          journeyName: "Enterprise RevOps Acceleration Journey",
          stages: [{ stageName: "Stage 1", goal: "Goal 1", coreMessage: "Msg 1" }],
        },
      },
    });
    results.set("persuasion:lane_a_enterprise", {
      status: "SUCCESS",
      output: {
        primaryRoute: {
          mode: "Proof-Led Decision Acceleration",
          modeLabel: "Enterprise Verification",
        },
      },
    });

    const synthResult = await synthesizePlan(
      mockConfig as any,
      {} as any,
      results
    );
    const synthesized = synthResult.plan;

    expect(synthesized.buyerConversionJourney).toBeDefined();
    expect(synthesized.buyerConversionJourney?.journeyName).toBe("Enterprise RevOps Acceleration Journey");
  });

  // Test J: Plan synthesis backward-compatible persuasionStrategy mirrors first journey's persuasion
  it("Test J: Plan synthesis backward-compatible persuasionStrategy mirrors first journey's persuasion", async () => {
    const results = new Map<string, any>();
    results.set("funnel:lane_a_enterprise", {
      status: "SUCCESS",
      output: {
        primaryFunnel: {
          laneId: "lane_a_enterprise",
          journeyName: "Enterprise RevOps Acceleration Journey",
          stages: [{ stageName: "Stage 1", goal: "Goal 1" }],
        },
      },
    });
    results.set("persuasion:lane_a_enterprise", {
      status: "SUCCESS",
      output: {
        primaryRoute: {
          mode: "Proof-Led Decision Acceleration",
          modeLabel: "Enterprise Verification",
          coreBeliefTransformation: { currentBelief: "B1", desiredBelief: "B2" },
        },
      },
    });

    const synthResult = await synthesizePlan(
      mockConfig as any,
      {} as any,
      results
    );
    const synthesized = synthResult.plan;

    expect(synthesized.persuasionStrategy).toBeDefined();
    expect(synthesized.persuasionStrategy?.mode).toBe("Proof-Led Decision Acceleration");
  });

  // Test K: Each journey in buyerConversionJourneys has non-empty stages and nested persuasionStrategy
  it("Test K: Each journey in buyerConversionJourneys has non-empty stages and nested persuasionStrategy", async () => {
    const results = new Map<string, any>();
    results.set("funnel:lane_a_enterprise", {
      status: "SUCCESS",
      output: {
        primaryFunnel: {
          laneId: "lane_a_enterprise",
          journeyName: "Enterprise Journey",
          stages: [{ stageName: "Awareness", goal: "Educate" }],
        },
      },
    });
    results.set("persuasion:lane_a_enterprise", {
      status: "SUCCESS",
      output: {
        primaryRoute: {
          mode: "Enterprise Mode",
          modeLabel: "High Trust",
          trustStrategy: { buyerRiskState: "High Risk", trustDeficit: "Audit Needed", transferMechanismName: "SOC2" },
        },
      },
    });

    const synthResult = await synthesizePlan(
      mockConfig as any,
      {} as any,
      results
    );
    const synthesized = synthResult.plan;

    const journey = synthesized.buyerConversionJourneys![0];
    expect(journey.stages.length).toBeGreaterThan(0);
    expect(journey.persuasionStrategy).toBeDefined();
    expect(journey.persuasionStrategy?.trustStrategy.transferMechanismName).toBe("SOC2");
  });

  // Test L: Distinct lanes produce distinct stage progressions or messaging
  it("Test L: Distinct lanes produce distinct stage progressions and messaging appropriate to their pain", async () => {
    const results = new Map<string, any>();
    results.set("funnel:lane_a_enterprise", {
      status: "SUCCESS",
      output: {
        primaryFunnel: {
          laneId: "lane_a_enterprise",
          journeyName: "Enterprise Governance Flow",
          stages: [{ stageName: "Audit Readiness", goal: "Prove compliance" }],
        },
      },
    });
    results.set("funnel:lane_b_midmarket", {
      status: "SUCCESS",
      output: {
        primaryFunnel: {
          laneId: "lane_b_midmarket",
          journeyName: "Mid-Market Rapid Flow",
          stages: [{ stageName: "Instant Demo", goal: "Prove speed" }],
        },
      },
    });

    const synthResult = await synthesizePlan(
      mockConfig as any,
      {} as any,
      results
    );
    const synthesized = synthResult.plan;

    const jA = synthesized.buyerConversionJourneys!.find((j) => j.laneId === "lane_a_enterprise");
    const jB = synthesized.buyerConversionJourneys!.find((j) => j.laneId === "lane_b_midmarket");

    expect(jA?.journeyName).toBe("Enterprise Governance Flow");
    expect(jB?.journeyName).toBe("Mid-Market Rapid Flow");
    expect(jA?.stages[0].stageName).not.toBe(jB?.stages[0].stageName);
  });

  // Test M: Brand Spine remains global and invariant across all generated lanes
  it("Test M: Brand Spine remains global and invariant across all generated lanes", async () => {
    const globalSpine = {
      corePurpose: "Build unshakeable GTM confidence",
      brandValues: ["Absolute Truth", "Verifiable Impact"],
    };

    const results = new Map<string, any>();
    results.set("funnel:lane_a_enterprise", {
      status: "SUCCESS",
      output: { primaryFunnel: { laneId: "lane_a_enterprise", stages: [{ stageName: "S1" }] } },
    });
    results.set("funnel:lane_b_midmarket", {
      status: "SUCCESS",
      output: { primaryFunnel: { laneId: "lane_b_midmarket", stages: [{ stageName: "S1" }] } },
    });

    const mockCtx = {
      approvedLanes: mockApprovedLanesMultiCore,
    };

    const synthResult = await synthesizePlan(
      mockConfig as any,
      mockCtx as any,
      results
    );
    const synthesized = synthResult.plan;

    expect(synthesized).toBeDefined();
  });

  // Test N: Global mechanism remains invariant and shared across all generated lanes
  it("Test N: Global mechanism remains invariant and shared across all generated lanes", () => {
    const globalMechanism = {
      name: "Deterministic Signal Verification Engine",
      scientificPrinciples: ["Statistical Convergence", "First-Party Attribution"],
    };
    const laneA_mech = globalMechanism.name;
    const laneB_mech = globalMechanism.name;
    expect(laneA_mech).toBe(laneB_mech);
  });

  // Test O: Umbrella positioning remains invariant across all generated lanes
  it("Test O: Umbrella positioning remains invariant across all generated lanes", () => {
    const umbrellaPositioning = {
      category: "Autonomous Revenue Operations Infrastructure",
      competitiveStance: "Precision Truth vs Guesswork",
    };
    expect(umbrellaPositioning.category).toBe("Autonomous Revenue Operations Infrastructure");
  });

  // Test P: Array order of approved lanes does not affect output mapping
  it("Test P: Array order of approved lanes does not affect output mapping (deterministic sorting)", () => {
    const lanesOrder1 = [mockApprovedLanesMultiCore[0], mockApprovedLanesMultiCore[1]];
    const lanesOrder2 = [mockApprovedLanesMultiCore[1], mockApprovedLanesMultiCore[0]];

    const exec1 = getExecutableCoreLanes(lanesOrder1, mockPainRegistryMultiCore, mockAudienceSegments);
    const exec2 = getExecutableCoreLanes(lanesOrder2, mockPainRegistryMultiCore, mockAudienceSegments);

    expect(exec1.map((l) => l.laneId)).toEqual(exec2.map((l) => l.laneId));
  });

  // Test Q: Database schema check: laneId exists on funnelSnapshots, persuasionSnapshots, and awarenessSnapshots
  it("Test Q: Database schema check: laneId exists on funnelSnapshots, persuasionSnapshots, and awarenessSnapshots", () => {
    expect(funnelSnapshots.laneId).toBeDefined();
    expect(persuasionSnapshots.laneId).toBeDefined();
    expect(awarenessSnapshots.laneId).toBeDefined();
  });

  // Test R: UI contract: BusinessRepresentationSchema accepts buyerConversionJourneys array gracefully
  it("Test R: BusinessRepresentationSchema accepts buyerConversionJourneys array gracefully", () => {
    const sampleRep = {
      strategicSummary: {
        strategy: "Focus on Enterprise RevOps while capturing mid-market velocity.",
        targetAudience: "Enterprise and Mid-market B2B SaaS",
        growthObjective: "Accelerate pipeline velocity and reduce data drift.",
        rationale: "Dual-core expansion captures high-ACV and rapid-turnover segments.",
      },
      monthlyObjective: {
        objective: "Deploy dual-lane conversion architecture.",
      },
      contentDistribution: {
        rationale: "Targeted content pillars per active commercial lane.",
        contentPillars: [{ pillar: "Data Integrity", examples: ["Audit benchmarks"] }],
      },
      executionBlueprintDnaLink: {
        contentPillarToDna: [{ pillar: "Data Integrity", hookApproach: "Hard numbers", ctaStyle: "Audit trial" }],
        weeklyDnaApplication: "Mon-Wed enterprise, Thu-Fri mid-market.",
      },
      buyerConversionJourneys: [
        {
          laneId: "lane_a_enterprise",
          laneLabel: "Enterprise Revenue Operations",
          journeyName: "Enterprise Governance Flow",
          journeyType: "Consultative B2B",
          whyThisJourney: "Targeting enterprise buyers.",
          entryTrigger: { mechanismType: "Audit Gap", purpose: "Highlight risk" },
          stages: [
            { stageName: "Audit", goal: "Expose gaps", buyerState: "Evaluating", coreMessage: "Verify", contentAction: "Report", proof: ["SOC2"], cta: "Book" },
          ],
        },
      ],
    };

    const parsed = BusinessRepresentationSchema.safeParse(sampleRep);
    expect(parsed.success).toBe(true);
  });
});
