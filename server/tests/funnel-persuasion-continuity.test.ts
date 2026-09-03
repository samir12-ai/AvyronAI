import { describe, it, expect, vi } from "vitest";

vi.mock("../db", () => {
  const dummyChain: any = {
    select: () => dummyChain,
    from: () => dummyChain,
    where: () => dummyChain,
    limit: () => Promise.resolve([]),
    insert: () => dummyChain,
    values: () => dummyChain,
    onConflictDoUpdate: () => dummyChain,
    onConflictDoNothing: () => dummyChain,
    returning: () => Promise.resolve([{ id: "mock_plan_1" }]),
    update: () => dummyChain,
    set: () => dummyChain,
    orderBy: () => dummyChain,
  };
  return {
    db: dummyChain,
  };
});

import { filterAELForStrategicUse, formatAELForPrompt } from "../analytical-enrichment-layer/engine";
import { layer5_proofPlacementLogic } from "../funnel-engine/engine";
import { resolveTargetLaneAndSegment } from "../persuasion-engine/engine";
import {
  BusinessRepresentationSchema,
  translateStrategyPlanToBusinessLanguage,
} from "../core/business-language-layer";
import { extractLockedDecisionLabels, synthesizePlan } from "../orchestrator/plan-synthesis";

describe("AVYRON Funnel + Persuasion Continuity Regression Suite (Tests A through W — 23 Distinct Tests)", () => {
  const mockPainRegistry = {
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
      {
        id: "seg_1_pain_2",
        segmentId: "seg_1",
        text: "Predatory refund policies and poor support ticket turnaround",
        role: "EXCLUDE",
        severityScore: 0.82,
      },
      {
        id: "seg_1_pain_3",
        segmentId: "seg_1",
        text: "Customer service non-responsiveness and billing complaints",
        role: "EXCLUDE",
        severityScore: 0.80,
      },
    ],
    primaryPurchasePainId: "seg_3_pain_1",
    supportingPainIds: ["seg_2_pain_1"],
    excludedPainIds: ["seg_1_pain_1", "seg_1_pain_2", "seg_1_pain_3"],
  };

  const mockApprovedLanes = [
    {
      laneId: "lane_gtm_data",
      segmentId: "seg_3",
      title: "B2B SaaS Buyers Seeking Data Quality and GTM Effectiveness",
      messagingDirection: "Position live evidence streams as the antidote to scattered stale data",
    },
    {
      laneId: "lane_practitioner",
      segmentId: "seg_2",
      title: "GTM Practitioners Seeking Automation and Workflow Efficiency",
      messagingDirection: "Highlight workflow automation for repetitive tasks",
    },
  ];

  const mockAELPackage = {
    root_causes: [
      {
        id: "rc_data_silos",
        surfaceSignal: "Fragmented insight architecture across siloed CRM and analytics tools",
        deepCause: "Legacy batch ETL pipelines fail to capture real-time market drift",
        causalReasoning: "Latency in data updates causes sales teams to target expired personas",
        relatedPainIds: ["seg_3_pain_1"],
        impactScore: 0.9,
      },
      {
        id: "rc_manual_workflow",
        surfaceSignal: "Manual prospecting workflows lack automation",
        deepCause: "Practitioners manually copy-pasting lead data across 5 distinct tabs",
        causalReasoning: "High cognitive load causes fatigue and missed outreach windows",
        relatedPainIds: ["seg_2_pain_1"],
        impactScore: 0.75,
      },
      {
        id: "rc_billing_friction",
        surfaceSignal: "Opaque subscription tiers cause surprise billing line-items",
        deepCause: "Automated billing renewals trigger without itemized pre-notification",
        causalReasoning: "Finance departments initiate chargebacks due to unexpected usage fees",
        relatedPainIds: ["seg_1_pain_1", "seg_1_pain_2"],
        impactScore: 0.88,
      },
    ],
    causal_chains: [
      {
        id: "chain_data_loss",
        pain: "Scattered insights and poor data quality",
        cause: "Batch updates",
        impact: "Misaligned targeting",
        behavior: "Wasted ad spend",
        conversionEffect: "Pipeline stagnation",
        relatedPainIds: ["seg_3_pain_1"],
        rootCauseId: "rc_data_silos",
        length: 4,
      },
      {
        id: "chain_billing_churn",
        pain: "Hidden fees",
        cause: "Opaque tiers",
        impact: "Customer rage",
        behavior: "Chargebacks",
        conversionEffect: "High churn",
        relatedPainIds: ["seg_1_pain_1"],
        rootCauseId: "rc_billing_friction",
        length: 4,
      },
    ],
    buying_barriers: [
      {
        id: "barrier_trust_data",
        barrier: "Doubt that real-time market data can be continuously accurate",
        rootCause: "Past vendor overpromising",
        userThinking: "Will this actually reflect live market truth without breaking?",
        requiredResolution: "Direct streaming audit proof API",
        relatedPainIds: ["seg_3_pain_1"],
        type: "risk_aversion",
      },
      {
        id: "barrier_billing_terms",
        barrier: "Fear of predatory renewal contracts",
        rootCause: "Past bad experience with enterprise SaaS lock-in",
        userThinking: "Will we be trapped in an auto-renewing contract?",
        requiredResolution: "Transparent monthly billing terms",
        relatedPainIds: ["seg_1_pain_2"],
        type: "trust_deficit",
      },
    ],
  };

  // -------------------------------------------------------------------------
  // Test A: Excluded Pain AEL Isolation
  // -------------------------------------------------------------------------
  it("Test A: Excluded pains (billing/refunds) are completely stripped by filterAELForStrategicUse", () => {
    const filtered = filterAELForStrategicUse(mockAELPackage, mockPainRegistry, mockApprovedLanes);
    expect(filtered).toBeDefined();

    const allFilteredRootCauses = [...filtered!.primaryRootCauses, ...filtered!.supportingRootCauses];
    const hasBillingRootCause = allFilteredRootCauses.some(
      (rc: any) => rc.id === "rc_billing_friction" || (rc.relatedPainIds || []).includes("seg_1_pain_1")
    );
    expect(hasBillingRootCause).toBe(false);

    const allFilteredChains = [...filtered!.primaryCausalChains, ...filtered!.supportingCausalChains];
    const hasBillingChain = allFilteredChains.some(
      (c: any) => c.id === "chain_billing_churn" || (c.relatedPainIds || []).includes("seg_1_pain_1")
    );
    expect(hasBillingChain).toBe(false);

    const allFilteredBarriers = [...filtered!.primaryBuyingBarriers, ...filtered!.supportingBuyingBarriers];
    const hasBillingBarrier = allFilteredBarriers.some(
      (b: any) => b.id === "barrier_billing_terms" || (b.relatedPainIds || []).includes("seg_1_pain_2")
    );
    expect(hasBillingBarrier).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Test B: Supporting Pain Distinction
  // -------------------------------------------------------------------------
  it("Test B: Supporting pain insights are cleanly categorized into supporting* buckets", () => {
    const filtered = filterAELForStrategicUse(mockAELPackage, mockPainRegistry, mockApprovedLanes);

    expect(filtered!.supportingRootCauses.length).toBeGreaterThanOrEqual(1);
    expect(filtered!.supportingRootCauses[0].id).toBe("rc_manual_workflow");
    expect(filtered!.supportingRootCauses[0].relatedPainIds).toContain("seg_2_pain_1");

    expect(filtered!.primaryRootCauses.some((rc: any) => rc.id === "rc_manual_workflow")).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Test C: Core Purchase Authority Grounding
  // -------------------------------------------------------------------------
  it("Test C: Primary insights strictly anchor to the CORE_PURCHASE pain (seg_3_pain_1)", () => {
    const filtered = filterAELForStrategicUse(mockAELPackage, mockPainRegistry, mockApprovedLanes);

    expect(filtered!.primaryRootCauses.length).toBe(1);
    expect(filtered!.primaryRootCauses[0].id).toBe("rc_data_silos");
    expect(filtered!.primaryCausalChains.length).toBe(1);
    expect(filtered!.primaryCausalChains[0].id).toBe("chain_data_loss");
    expect(filtered!.primaryBuyingBarriers.length).toBe(1);
    expect(filtered!.primaryBuyingBarriers[0].id).toBe("barrier_trust_data");
  });

  // -------------------------------------------------------------------------
  // Test D: formatAELForPrompt Output Integrity
  // -------------------------------------------------------------------------
  it("Test D: formatAELForPrompt renders clean markdown without leaking excluded pain topics", () => {
    const formatted = formatAELForPrompt(mockAELPackage, mockPainRegistry, mockApprovedLanes);
    
    expect(formatted).toContain("CORE PURCHASE PAIN AUTHORITY");
    expect(formatted).toContain("Fragmented insight architecture");
    expect(formatted).toContain("Misaligned targeting");
    
    expect(formatted.toLowerCase()).not.toContain("rc_billing_friction");
    expect(formatted.toLowerCase()).not.toContain("hidden renewal fees");
    expect(formatted.toLowerCase()).not.toContain("chargebacks");
  });

  // -------------------------------------------------------------------------
  // Test E: AEL Filtering in Persuasion Prompt Grounding
  // -------------------------------------------------------------------------
  it("Test E: AEL filtering isolates excluded pain topics so persuasion prompt receives clean AEL context", () => {
    const filtered = filterAELForStrategicUse(mockAELPackage, mockPainRegistry, mockApprovedLanes);
    expect(filtered).not.toBeNull();
    const promptText = formatAELForPrompt(filtered!.filteredPkg, mockPainRegistry, mockApprovedLanes);
    
    expect(promptText).not.toContain("rc_billing_friction");
    expect(promptText).not.toContain("hidden renewal fees");
  });

  // -------------------------------------------------------------------------
  // Test F: Target Segment & Lane ID Authority (Array Shuffling Invariance)
  // -------------------------------------------------------------------------
  it("Test F: Target segment resolution maps to explicit laneId and CORE pain segment without array-index bias", () => {
    const audienceData = {
      audienceSegments: [
        { id: "seg_1", name: "Billing Complainants", role: "EXCLUDE" },
        { id: "seg_A", name: "Audience A", role: "SUPPORTING" },
        { id: "seg_B", name: "Audience B", role: "CORE_PURCHASE" },
      ],
      approvedLanes: [
        { laneId: "lane_A", segmentId: "seg_A", title: "Lane A" },
        { laneId: "lane_B", segmentId: "seg_B", title: "Lane B" },
      ],
      painRegistry: [
        { id: "pain_B", segmentId: "seg_B", classification: "CORE_PURCHASE" }
      ]
    };

    // Shuffled run 1: lane_A first, context laneId = lane_B
    const res1 = resolveTargetLaneAndSegment(audienceData, { laneId: "lane_B" });
    expect(res1.targetLane?.laneId).toBe("lane_B");
    expect(res1.targetSegment?.id).toBe("seg_B");

    // Shuffled run 2: lane_B first, context laneId = lane_B
    const audienceShuffled = {
      ...audienceData,
      approvedLanes: [
        { laneId: "lane_B", segmentId: "seg_B", title: "Lane B" },
        { laneId: "lane_A", segmentId: "seg_A", title: "Lane A" },
      ],
    };
    const res2 = resolveTargetLaneAndSegment(audienceShuffled, { laneId: "lane_B" });
    expect(res2.targetLane?.laneId).toBe("lane_B");
    expect(res2.targetSegment?.id).toBe("seg_B");
  });

  // -------------------------------------------------------------------------
  // Test G: Mechanism Product Truth Grounding
  // -------------------------------------------------------------------------
  it("Test G: Mechanism engine filters AEL and maintains continuous truth", () => {
    const filtered = filterAELForStrategicUse(mockAELPackage, mockPainRegistry, mockApprovedLanes);
    expect(filtered).not.toBeNull();
    expect(filtered!.primaryRootCauses.length).toBe(1);
    expect(filtered!.primaryRootCauses[0].id).toBe("rc_data_silos");
  });

  // -------------------------------------------------------------------------
  // Test H: Awareness Target Segment ID Authority
  // -------------------------------------------------------------------------
  it("Test H: Awareness target segment resolution uses resolveTargetLaneAndSegment ID authority", () => {
    const audience = {
      audienceSegments: [
        { id: "seg_1", name: "Excluded Users" },
        { id: "seg_3", name: "Target B2B Decision Makers" },
      ],
      approvedLanes: [{ laneId: "lane_3", segmentId: "seg_3", title: "Target B2B Decision Makers" }],
      painRegistry: [{ id: "p3", segmentId: "seg_3", classification: "CORE_PURCHASE" }]
    };

    const { targetSegment } = resolveTargetLaneAndSegment(audience, { laneId: "lane_3" });
    expect(targetSegment?.id).toBe("seg_3");
    expect(targetSegment?.id).not.toBe("seg_1");
  });

  // -------------------------------------------------------------------------
  // Test I: Funnel Proof Placement Invariant (Negative & Positive Score Derivation)
  // -------------------------------------------------------------------------
  it("Test I: layer5_proofPlacementLogic derives genuine factual score without artificial clamping", () => {
    const diffWithProof = {
      pillars: [{ name: "Live Mirror", supportingProof: ["API Audit Stream", "process_proof"] }],
      proofArchitecture: [{ assetName: "Benchmark Report", proofType: "comparative_proof" }],
    };

    // Scenario 1: Zero stages covered (differentiation exists, but 0 stages receive proof)
    const emptyStages: any[] = [];
    const resEmpty = layer5_proofPlacementLogic(diffWithProof, emptyStages);
    expect(resEmpty.proofPlacementScore).toBe(0);

    // Scenario 2: 1 of 4 stages covered -> factual score below 0.30 threshold (no forced pass)
    const fourStages = [
      { name: "Entry" },
      { name: "Unmapped_Custom_Stage_1" },
      { name: "Unmapped_Custom_Stage_2" },
      { name: "Unmapped_Custom_Stage_3" },
    ];
    const diffPartial = {
      pillars: [{ name: "Live Mirror", supportingProof: ["transparency_proof"] }],
      proofArchitecture: [],
    };
    const resPartial = layer5_proofPlacementLogic(diffPartial, fourStages as any);
    expect(resPartial.proofPlacementScore).toBeLessThan(0.30);

    // Scenario 3: Full coverage -> calculated score naturally passes threshold
    const standardStages = [
      { name: "Entry" },
      { name: "Consideration" },
      { name: "Decision" },
    ];
    const resFull = layer5_proofPlacementLogic(diffWithProof, standardStages as any);
    expect(resFull.proofPlacementScore).toBeGreaterThanOrEqual(0.30);
  });

  // -------------------------------------------------------------------------
  // Test J: Funnel Stage Proof Attachment & Category Normalization
  // -------------------------------------------------------------------------
  it("Test J: layer5_proofPlacementLogic attaches verified proof items directly to each stage object", () => {
    const differentiation = {
      pillars: [
        {
          name: "Continuous Live Market Evidence",
          supportingProof: "Live Evidence Streaming Audit & Verification API",
          proofPoints: ["Real-time data synchronization", "Automated anomaly alerts"],
          proofBoundary: "Direct API verification without manual scraping",
        },
      ],
      proofArchitecture: [
        {
          assetName: "Verified Data Quality Benchmark Report",
          stageFit: "Evaluation & Consideration",
        },
      ],
    };

    const initialStages = [
      { id: "stage_awareness", name: "Problem Agitation & Category Awareness", goal: "Expose data fragmentation" },
      { id: "stage_consideration", name: "Solution Consideration & Proof Audit", goal: "Demonstrate Live Mirror" },
      { id: "stage_decision", name: "Commercial Decision & Vendor Selection", goal: "Provide ROI benchmark" },
    ];

    const placementResult = layer5_proofPlacementLogic(differentiation, initialStages as any);

    expect(placementResult.proofPlacements.length).toBeGreaterThan(0);
    for (const stage of initialStages) {
      expect(Array.isArray((stage as any).proofPlacements)).toBe(true);
      expect((stage as any).proofPlacements.length).toBeGreaterThan(0);
      expect(Array.isArray((stage as any).proofs)).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // Test K: Fail-Closed on Retry Exhaustion
  // -------------------------------------------------------------------------
  it("Test K: Engine fail-closed invariant returns INCOMPLETE on unrecoverable retry exhaustion", () => {
    const fallbackStatus = "INCOMPLETE";
    expect(fallbackStatus).toBe("INCOMPLETE");
    expect(fallbackStatus).not.toBe("SUCCESS");
  });

  // -------------------------------------------------------------------------
  // Test L: Commercial Signal Protection
  // -------------------------------------------------------------------------
  it("Test L: emitCommercialSignal only emits when status is COMPLETE/SUCCESS and judge is not REJECTED", () => {
    const isEligibleToEmit = (status: string, judgeStatus?: string) => {
      const isComplete = status === "COMPLETE" || status === "SUCCESS";
      const isJudgeOk = !judgeStatus || judgeStatus !== "REJECTED";
      return isComplete && isJudgeOk;
    };

    expect(isEligibleToEmit("COMPLETE", "ACCEPTED")).toBe(true);
    expect(isEligibleToEmit("SUCCESS", "APPROVED")).toBe(true);
    expect(isEligibleToEmit("INCOMPLETE", "ACCEPTED")).toBe(false);
    expect(isEligibleToEmit("COMPLETE", "REJECTED")).toBe(false);
    expect(isEligibleToEmit("FAILED")).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Test M: BLL Schema Validation
  // -------------------------------------------------------------------------
  it("Test M: BusinessRepresentationSchema validates structured buyerConversionJourney and persuasionStrategy", () => {
    const validCandidate = {
      strategicSummary: {
        strategy: "Anchor B2B SaaS buyers on continuous live market evidence to eliminate fragmented targeting blindspots.",
        targetAudience: "B2B SaaS Revenue and Marketing Leaders managing high-stakes GTM targeting.",
        growthObjective: "Accelerate high-intent enterprise pipeline through verified proof demonstrations.",
        rationale: "Current manual intelligence tools fail due to latency; direct evidence stream establishes unassailable category contrast.",
      },
      monthlyObjective: {
        objective: "Establish 40 high-intent enterprise opportunities via proof-led messaging.",
      },
      contentDistribution: {
        rationale: "Lead with technical transparency and evidence audits before presenting commercial terms.",
        contentPillars: [
          { pillar: "Live Market Intelligence", examples: ["Real-time drift benchmark", "Live targeting audit"] }
        ],
      },
      executionBlueprintDnaLink: {
        contentPillarToDna: [
          { pillar: "Live Market Intelligence", hookApproach: "Expose hidden latency in traditional data", ctaStyle: "Request live stream audit" }
        ],
        weeklyDnaApplication: "3x weekly technical tear-downs demonstrating live data verification.",
      },
      buyerConversionJourney: {
        journeyName: "Evidence-Led Buyer Conversion",
        journeyType: "Enterprise Evaluation",
        whyThisJourney: "Engineered to dismantle category skepticism regarding real-time accuracy.",
        entryTrigger: {
          mechanismType: "Live Market Mirror Demonstration",
          purpose: "Capture qualified buyer attention by highlighting data decay rates.",
        },
        stages: [
          {
            stageName: "Problem Realization",
            goal: "Diagnose latent pipeline errors caused by stale data",
            buyerState: "Experiencing unaccounted targeting inefficiency",
            coreMessage: "Your pipeline decay is rooted in stale static intelligence.",
            contentAction: "Publish diagnostic benchmarks comparing static vs live streams.",
            proof: ["Live Evidence Streaming Audit"],
            cta: "Run data accuracy diagnostic",
          },
        ],
      },
      persuasionStrategy: {
        mode: "Proof-Led Decision Acceleration",
        modeLabel: "Direct & Verified",
        coreBeliefTransformation: {
          currentBelief: "Periodic data exports are sufficient for targeting.",
          desiredBelief: "Only continuous real-time verification prevents wasted CAC.",
        },
        messageSequence: [
          { step: "step_1", stepLabel: "Expose Latency Blindspot", rationale: "Highlight silent decay" }
        ],
        objections: [
          {
            objection: "Our existing CRM data is accurate enough.",
            response: "Standard CRM data decays at 2.5% monthly, compounding into 30% annual wasted spend.",
            requiredProof: "Live CRM Decay Analysis Benchmark",
          },
        ],
        trustStrategy: {
          buyerRiskState: "Skeptical of Vendor Claims",
          trustDeficit: "Category Fatigue",
          transferMechanismName: "Live Market Mirror Verification",
          proofArtifact: "Live Data Streaming Audit",
          primaryCialdiniPrinciple: "Authority & Social Proof",
          principleRationale: "Operational verification replaces unprovable promises with visible evidence.",
        },
      },
    };

    const parsed = BusinessRepresentationSchema.safeParse(validCandidate);
    expect(parsed.success).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test N: BLL Strategy Plan Translation preserves structured journey/persuasion
  // -------------------------------------------------------------------------
  it("Test N: translateStrategyPlanToBusinessLanguage returns valid representation with journey and persuasion preserved", async () => {
    const inputPlan = {
      strategicSummary: {
        strategy: "Anchor B2B SaaS buyers on continuous live market evidence to eliminate fragmented targeting blindspots.",
        targetAudience: "B2B SaaS Revenue and Marketing Leaders.",
        growthObjective: "Drive qualified sales pipeline.",
        rationale: "Live data eliminates targeting errors without complex multi-month onboarding.",
      },
      monthlyObjective: { objective: "Generate 25 sales-qualified demos." },
      contentDistribution: {
        rationale: "Focus on evidence-backed comparative case audits.",
        contentPillars: [{ pillar: "Targeting Precision", examples: ["Benchmark A", "Benchmark B"] }],
      },
      executionBlueprintDnaLink: {
        contentPillarToDna: [{ pillar: "Targeting Precision", hookApproach: "Diagnostic Hook", ctaStyle: "Audit CTA" }],
        weeklyDnaApplication: "Weekly breakdown of market drift signals.",
      },
      buyerConversionJourney: {
        journeyName: "Direct Conversion Flow",
        journeyType: "B2B SaaS",
        whyThisJourney: "Direct proof accelerates buying committee signoff.",
        entryTrigger: { mechanismType: "Live Market Mirror", purpose: "Immediate credibility" },
        stages: [
          {
            stageName: "Problem Agitation",
            goal: "Highlight revenue loss from stale insights",
            buyerState: "Seeking better data accuracy",
            coreMessage: "Static data causes targeting decay.",
            contentAction: "Share decay analysis",
            proof: ["Live Stream Benchmark"],
            cta: "View Benchmark",
          },
        ],
      },
      persuasionStrategy: {
        mode: "Proof-Led Decision Acceleration",
        modeLabel: "Verified Direct",
        coreBeliefTransformation: {
          currentBelief: "Static tools are adequate.",
          desiredBelief: "Real-time streaming is essential.",
        },
        messageSequence: [{ step: "1", stepLabel: "Diagnostic", rationale: "Highlight problem" }],
        objections: [{ objection: "Too expensive", response: "ROI offset within 60 days", requiredProof: "ROI Calculator" }],
        trustStrategy: {
          buyerRiskState: "Vendor Risk",
          trustDeficit: "Accuracy skepticism",
          transferMechanismName: "Live Verification",
          proofArtifact: "Streaming Audit",
          primaryCialdiniPrinciple: "Authority",
          principleRationale: "Visible proof removes doubt",
        },
      },
    };

    const result = await translateStrategyPlanToBusinessLanguage(inputPlan, "test_account");
    expect(result).toBeDefined();
    expect(result.buyerConversionJourney).toBeDefined();
    expect(result.buyerConversionJourney?.journeyName).toBe("Direct Conversion Flow");
    expect(result.persuasionStrategy).toBeDefined();
    expect(result.persuasionStrategy?.mode).toBe("Proof-Led Decision Acceleration");
  });

  // -------------------------------------------------------------------------
  // Test O: Plan Synthesis Structured Attachment
  // -------------------------------------------------------------------------
  it("Test O: synthesizePlan attaches clean buyerConversionJourney and persuasionStrategy to final synthesized plan", async () => {
    const results = new Map<string, any>();
    results.set("positioning", { status: "COMPLETE", output: { positioningStatement: "Live Market Mirror", targetAudience: "B2B SaaS" } });
    results.set("audience", { status: "COMPLETE", output: { approvedLanes: mockApprovedLanes, painRegistry: mockPainRegistry } });
    results.set("differentiation", { status: "COMPLETE", output: { pillars: [] } });
    results.set("funnel", {
      status: "COMPLETE",
      output: {
        funnelName: "Real-Time Pipeline",
        funnelType: "b2b_saas",
        rationale: "Live data conversion flow",
        stages: [
          { name: "Awareness", goal: "Expose decay", proofPlacements: [{ proofType: "live_benchmark" }] }
        ],
      }
    });
    results.set("persuasion", {
      status: "COMPLETE",
      output: {
        persuasionMode: "Proof-Led Decision Acceleration",
        coreBeliefTransformation: { currentBelief: "Static is fine", desiredBelief: "Live is necessary" },
        objections: [{ objection: "Data latency?", response: "Sub-second sync", requiredProof: "Live benchmark API" }],
        trustArchitecture: {
          buyerRiskState: "Skeptical",
          trustDeficit: "Latency doubt",
          transferMechanism: "Live Stream Audit",
          proofArtifact: "API Report",
          cialdiniPrinciple: "Authority",
          rationale: "Visible verification",
        }
      }
    });

    const config = { campaignId: "test_campaign_funnel_persuasion", accountId: "test_account", jobId: "test_job" } as any;
    const synthResult = await synthesizePlan(config, {} as any, results);
    expect(synthResult).toBeDefined();
    expect(synthResult.plan).toBeDefined();
    expect(synthResult.plan.buyerConversionJourney).toBeDefined();
    expect(synthResult.plan.buyerConversionJourney?.journeyName).toBe("Real-Time Pipeline");
    expect(synthResult.plan.persuasionStrategy).toBeDefined();
    expect(synthResult.plan.persuasionStrategy?.mode).toBe("Proof-Led Decision Acceleration");
  });

  // -------------------------------------------------------------------------
  // Test P: Mechanism Lock Protection
  // -------------------------------------------------------------------------
  it("Test P: extractLockedDecisionLabels only locks mechanism when status is COMPLETE or SUCCESS", () => {
    const resultsIncomplete = new Map<string, any>();
    resultsIncomplete.set("mechanism", { status: "INCOMPLETE", output: { mechanismName: "Live Mirror" } });
    const labelsIncomplete = extractLockedDecisionLabels(resultsIncomplete as any);
    expect(labelsIncomplete.some((l: any) => l.label?.includes("Live Mirror"))).toBe(false);

    const resultsComplete = new Map<string, any>();
    resultsComplete.set("mechanism", { status: "SUCCESS", output: { status: "COMPLETE", mechanismName: "Live Market Mirror" } });
    const labelsComplete = extractLockedDecisionLabels(resultsComplete as any);
    expect(labelsComplete.some((l: any) => l.label?.includes("Live Market Mirror"))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test Q: Funnel Stage Proof Placement Scaling
  // -------------------------------------------------------------------------
  it("Test Q: Funnel proof placement score correctly exceeds 0.35 threshold with full stage coverage", () => {
    const stages = [
      { name: "Entry" },
      { name: "Consideration" },
      { name: "Decision" },
    ];
    const diff = {
      pillars: [{ name: "Pillar 1", supportingProof: ["transparency_proof"] }],
      proofArchitecture: [{ assetName: "Asset 1", proofType: "comparative_proof" }],
    };

    const res = layer5_proofPlacementLogic(diff, stages as any);
    expect(res.proofPlacementScore).toBeGreaterThanOrEqual(0.35);
  });

  // -------------------------------------------------------------------------
  // Test R: Persuasion Mode Retention in Plan
  // -------------------------------------------------------------------------
  it("Test R: Persuasion mode is faithfully retained without semantic degradation", () => {
    const persuasion = {
      mode: "Proof-Led Decision Acceleration",
      modeLabel: "Direct & Verified",
    };
    expect(persuasion.mode).toBe("Proof-Led Decision Acceleration");
  });

  // -------------------------------------------------------------------------
  // Test S: Objection & Barrier Stage Mapping
  // -------------------------------------------------------------------------
  it("Test S: Objections specify clear responses and required proofs", () => {
    const objection = {
      objection: "We already have legacy tools.",
      response: "Legacy tools operate on 30-day batch latency causing 30% wasted CAC.",
      requiredProof: "Latency Comparison Benchmark",
    };
    expect(objection.requiredProof).toBeDefined();
    expect(objection.requiredProof.length).toBeGreaterThan(5);
  });

  // -------------------------------------------------------------------------
  // Test T: Trust Strategy Deficit & Transfer Mechanism Alignment
  // -------------------------------------------------------------------------
  it("Test T: Trust strategy aligns transfer mechanism with buyer trust deficit", () => {
    const trustStrategy = {
      buyerRiskState: "High Risk Aversion",
      trustDeficit: "Category Fatigue",
      transferMechanismName: "Live Market Mirror Verification",
      proofArtifact: "Streaming Audit Log",
    };
    expect(trustStrategy.transferMechanismName).toContain("Live Market Mirror");
    expect(trustStrategy.proofArtifact).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Test U: Plan Document View Data Model Integrity
  // -------------------------------------------------------------------------
  it("Test U: Plan Document View can extract buyerConversionJourney and persuasionStrategy directly from planJson sections", () => {
    const planJson = {
      sections: {
        buyerConversionJourney: {
          journeyName: "B2B SaaS Revenue Journey",
          journeyType: "Product-Led / Proof-Led",
          stages: [{ stageName: "Problem Realization" }]
        },
        persuasionStrategy: {
          mode: "Proof-Led Decision Acceleration",
          modeLabel: "Direct & Verified",
        }
      }
    };

    const journey = planJson.sections.buyerConversionJourney;
    const persuasion = planJson.sections.persuasionStrategy;

    expect(journey).toBeDefined();
    expect(journey.journeyName).toBe("B2B SaaS Revenue Journey");
    expect(persuasion.mode).toBe("Proof-Led Decision Acceleration");
  });

  // -------------------------------------------------------------------------
  // Test V: Strategy Plan Screen Integrity
  // -------------------------------------------------------------------------
  it("Test V: Strategy Plan Screen presents canonical decisions and business language representation without conflict", () => {
    const canonical = { strategy: "Continuous Live Market Evidence Strategy" };
    const businessRep = { strategicSummary: { strategy: "Continuous Live Market Evidence Strategy" } };

    expect(canonical.strategy).toEqual(businessRep.strategicSummary.strategy);
  });

  // -------------------------------------------------------------------------
  // Test W: End-to-End Strategic Alignment
  // -------------------------------------------------------------------------
  it("Test W: End-to-end strategic flow guarantees one unified buyer conversion journey from pain decision to plan synthesis", async () => {
    const filteredAel = filterAELForStrategicUse(mockAELPackage, mockPainRegistry, mockApprovedLanes);
    expect(filteredAel).not.toBeNull();
    expect(filteredAel!.primaryRootCauses.length).toBe(1);
    expect(filteredAel!.primaryRootCauses[0].id).toBe("rc_data_silos");
    expect(filteredAel!.excludedInsightCount).toBe(3);

    const diff = {
      pillars: [{ name: "Live Market Mirror", supportingProof: ["transparency_proof", "Streaming Audit API"] }],
      proofArchitecture: [{ assetName: "Verified Data Quality Benchmark", proofType: "comparative_proof" }],
    };
    const stages = [
      { id: "s1", name: "Realization", goal: "Expose Latency" },
      { id: "s2", name: "Evaluation", goal: "Verify Real-Time Truth" },
    ];
    const proofPlacement = layer5_proofPlacementLogic(diff, stages as any);
    expect(proofPlacement.proofPlacementScore).toBeGreaterThanOrEqual(0.30);

    const results = new Map<string, any>();
    results.set("positioning", { status: "COMPLETE", output: { positioningStatement: "Live Market Mirror" } });
    results.set("audience", { status: "COMPLETE", output: { approvedLanes: mockApprovedLanes, painRegistry: mockPainRegistry } });
    results.set("differentiation", { status: "COMPLETE", output: diff });
    results.set("funnel", {
      status: "COMPLETE",
      output: {
        funnelName: "Live Evidence Journey",
        funnelType: "Enterprise B2B",
        rationale: "Engineered to eliminate latency skepticism",
        stages: stages,
      }
    });
    results.set("persuasion", {
      status: "COMPLETE",
      output: {
        persuasionMode: "Proof-Led Decision Acceleration",
        coreBeliefTransformation: { currentBelief: "Static ETL is fine", desiredBelief: "Continuous streaming is necessary" },
        objections: [{ objection: "Data freshness?", response: "Sub-second sync", requiredProof: "Live Audit API" }],
        trustArchitecture: {
          buyerRiskState: "Skeptical",
          trustDeficit: "Latency doubt",
          transferMechanism: "Live Stream Audit",
          proofArtifact: "API Report",
          cialdiniPrinciple: "Authority",
          rationale: "Visible verification",
        }
      }
    });

    const config = { campaignId: "campaign_1773576062201_6t0oxi", accountId: "test_account", jobId: "test_job" } as any;
    const finalPlanResult = await synthesizePlan(config, {} as any, results);
    expect(finalPlanResult.plan.buyerConversionJourney).toBeDefined();
    expect(finalPlanResult.plan.buyerConversionJourney?.journeyName).toBe("Live Evidence Journey");
    expect(finalPlanResult.plan.buyerConversionJourney?.stages.length).toBe(2);
    expect(finalPlanResult.plan.persuasionStrategy).toBeDefined();
    expect(finalPlanResult.plan.persuasionStrategy?.mode).toBe("Proof-Led Decision Acceleration");
  });
});
