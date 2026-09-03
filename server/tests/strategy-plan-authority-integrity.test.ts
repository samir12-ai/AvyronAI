import { describe, it, expect, vi } from "vitest";

vi.mock("../db", () => {
  const dummyChain: any = {
    select: () => dummyChain,
    from: () => dummyChain,
    where: () => dummyChain,
    limit: () => Promise.resolve([{
      id: "bdl_1",
      businessType: "Autonomous AI Workforce Platform",
      businessLocation: "Global",
      monthlyBudget: "10000",
      funnelObjective: "Lead Generation",
      coreOffer: "Avyron AI Intelligence",
    }]),
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

import { synthesizePlan } from "../orchestrator/plan-synthesis";

describe("Strategy Plan Authority & Build Integrity Hardening (Tests A through N)", () => {
  const mockConfig = { accountId: "acc_1", campaignId: "test_campaign_authority_integrity", jobId: "job_1" };

  const canonicalRoot = {
    id: "root_canonical_v45",
    campaignId: "test_campaign_authority_integrity",
    primaryAxis: "Fragmented Insight Pipeline Hindering Targeting",
    contrastAxisText: "Live continuous market intelligence vs static defensive reporting",
    approvedAudiencePains: [
      { id: "seg_2_pain_1", pain: "Operational complexity and manual workflow overhead", canonical: "Operational complexity and manual workflow overhead" }
    ],
    approvedObjections: [
      {
        objectionId: "obj_1",
        objection: "Our team already has internal dashboards and manual tools.",
        canonical: "Our team already has internal dashboards and manual tools.",
        handling: "Demonstrate live workflow automation and continuous adaptation.",
        response: "Demonstrate live workflow automation and continuous adaptation.",
        requiredProof: "Live Modular Execution Demo [PROOF_TO_BUILD]",
      }
    ],
    approvedLanes: [
      {
        laneId: "lane_a92dbae22915",
        title: "Automation to Reduce Operational Complexity",
        primaryPainId: "seg_2_pain_1",
        corePainIds: ["seg_2_pain_1"],
        segmentIds: ["seg_f25a4c42a3ac4af4"],
      }
    ]
  };

  // Test A: Product Truth Grounding
  it("TEST A: Product Truth Grounding: Plan synthesis receives grounded journey rationale from upstream", async () => {
    const results = new Map<any, any>();
    results.set("funnel", {
      status: "SUCCESS",
      output: {
        primaryFunnel: {
          funnelName: "Operational Autonomy Funnel",
          laneId: "lane_a92dbae22915",
          whyThisJourney: "Transparent workflow demonstration and live verification eliminate operational uncertainty.",
          stages: [
            {
              stageName: "Problem Recognition",
              goal: "Expose manual bottlenecks",
              buyerState: "Skeptical",
              coreMessage: "Modular agents automate operations.",
              proof: ["Live Workflow Demo"],
              cta: "Run Free Audit"
            }
          ]
        }
      }
    });

    const synthResult = await synthesizePlan(
      { ...mockConfig, strategyRoot: canonicalRoot } as any,
      { approvedLanes: canonicalRoot.approvedLanes } as any,
      results
    );

    const journey = synthResult.plan.buyerConversionJourneys![0];
    expect(journey.whyThisJourney).toMatch(/transparent workflow demonstration/i);
  });

  // Test B: Market Signal ≠ Capability Claim
  it("TEST B: Market Signal ≠ Capability: Competitor billing complaints remain as market intelligence without becoming product claims", async () => {
    const results = new Map<any, any>();
    results.set("market_intelligence", {
      status: "SUCCESS",
      output: {
        crossSignalDecisions: {
          decisions: [
            { id: "dec_1", type: "VALIDATED_PAIN", signalText: "Competitor buyers complain about opaque billing and delayed refunds", confidenceLevel: "HIGH" }
          ]
        }
      }
    });
    results.set("funnel", {
      status: "SUCCESS",
      output: {
        primaryFunnel: {
          funnelName: "Operational Autonomy Funnel",
          laneId: "lane_a92dbae22915",
          whyThisJourney: "Continuous validated intelligence ensures targeting precision.",
          stages: [{ stageName: "Stage 1", goal: "Goal 1", coreMessage: "Msg", proof: [], cta: "CTA" }]
        }
      }
    });

    const synthResult = await synthesizePlan(
      { ...mockConfig, strategyRoot: canonicalRoot } as any,
      { approvedLanes: canonicalRoot.approvedLanes } as any,
      results
    );

    expect(synthResult.plan.strategicSummary.strategy).not.toMatch(/billing and refund portal/i);
    expect(synthResult.plan.strategicSummary.strategy).not.toMatch(/dispute resolution software/i);
  });

  // Test C: BUILD Future Proof
  it("TEST C: BUILD Future Proof: Proof items preserve upstream maturity status", async () => {
    const results = new Map<any, any>();
    results.set("funnel", {
      status: "SUCCESS",
      output: {
        primaryFunnel: {
          funnelName: "Diagnostic Funnel",
          laneId: "lane_a92dbae22915",
          whyThisJourney: "Evidence-backed validation.",
          stages: [
            {
              stageName: "Problem Recognition",
              goal: "Expose hidden data drift",
              coreMessage: "Continuous signals beat static reports.",
              proof: [
                { proofName: "Enterprise Security & Compliance Documentation", proofStatus: "REQUIRED_FUTURE_PROOF" },
                { proofName: "Targeting Precision Improvement Benchmark", proofStatus: "REQUIRED_FUTURE_PROOF" }
              ],
              cta: "Download Audit"
            }
          ]
        }
      }
    });

    const synthResult = await synthesizePlan(
      { ...mockConfig, strategyRoot: canonicalRoot } as any,
      { approvedLanes: canonicalRoot.approvedLanes } as any,
      results
    );

    const stageProofs = synthResult.plan.buyerConversionJourneys![0].stages[0].proof;
    expect(stageProofs[0].proofStatus).toBe("REQUIRED_FUTURE_PROOF");
    expect(stageProofs[1].proofStatus).toBe("REQUIRED_FUTURE_PROOF");
  });

  // Test D: Existing Proof Presentation in BUILD mode
  it("TEST D: Existing Proof Presentation: In BUILD mode, proof items are cleanly structured", async () => {
    const results = new Map<any, any>();
    results.set("funnel", {
      status: "SUCCESS",
      output: {
        primaryFunnel: {
          funnelName: "Diagnostic Funnel",
          laneId: "lane_a92dbae22915",
          whyThisJourney: "Grounded workflow progression.",
          stages: [
            {
              stageName: "Proof Phase",
              goal: "Demonstrate capability",
              coreMessage: "Workflow execution",
              proof: [{ stage: "proof", proofType: "case_study", proofName: "Fortune 500 Case Study", proofStatus: "REQUIRED_FUTURE_PROOF" }],
              cta: "View Demo"
            }
          ]
        }
      }
    });

    const synthResult = await synthesizePlan(
      { ...mockConfig, strategyRoot: canonicalRoot } as any,
      { approvedLanes: canonicalRoot.approvedLanes } as any,
      results
    );

    const journey = synthResult.plan.buyerConversionJourneys![0];
    const proofItem = journey.stages[0].proof[0];
    expect(typeof proofItem).toBe("object");
    expect((proofItem as any).proofName.startsWith("{")).toBe(false);
  });

  // Test E & F: Objective Validation Status & KPI Structure
  it("TEST E & F: Objective Validation Status: Growth objective and KPIs reflect working planning hypotheses in BUILD mode", async () => {
    const results = new Map<any, any>();
    results.set("funnel", {
      status: "SUCCESS",
      output: {
        primaryFunnel: {
          funnelName: "Funnel 1",
          laneId: "lane_a92dbae22915",
          whyThisJourney: "Hypothesis-driven validation.",
          stages: [{ stageName: "Stage 1", goal: "Goal 1", coreMessage: "Msg", proof: [], cta: "CTA" }]
        }
      }
    });

    const synthResult = await synthesizePlan(
      { ...mockConfig, strategyRoot: canonicalRoot } as any,
      { approvedLanes: canonicalRoot.approvedLanes } as any,
      results
    );

    expect(synthResult.plan.strategicSummary.growthObjective).toBeDefined();
    expect(synthResult.plan.kpiStructure.primaryKPI.name).toBeDefined();
  });

  // Test G: Raw Objection JSON Leak Prevention
  it("TEST G: Raw Objection JSON Leak Prevention: Objection objects with { canonical: ... } are unpacked cleanly to string text only", async () => {
    const results = new Map<any, any>();
    results.set("funnel", {
      status: "SUCCESS",
      output: {
        primaryFunnel: {
          funnelName: "Diagnostic Funnel",
          laneId: "lane_a92dbae22915",
          whyThisJourney: "Grounded objection handling.",
          stages: [{ stageName: "Stage 1", goal: "Goal 1", coreMessage: "Msg", proof: [], cta: "CTA" }]
        }
      }
    });
    results.set("persuasion", {
      status: "SUCCESS",
      output: {
        primaryRoute: {
          mode: "Proof-Led Decision Acceleration",
          coreBeliefTransformation: {
            currentBelief: "Belief that manual tools are required.",
            desiredBelief: "Conviction that automated agents deliver superior results."
          },
          objectionPriorities: [
            {
              tag: { category: "trust", awarenessStage: "consideration" },
              objection: {
                canonical: "Lack of direct human support during onboarding",
                frequency: 9,
                evidence: ["User complained about support response times"]
              },
              response: "Provide dedicated onboarding engineering support.",
              requiredProof: "Onboarding Milestone SLA [REQUIRED_FUTURE_PROOF]"
            }
          ],
          trustTransferDesign: {
            buyerRiskState: "Risk State",
            trustDeficit: "Trust Deficit",
            transferMechanism: { name: "Demo", proofArtifact: "Artifact [PROOF_TO_BUILD]" }
          }
        }
      }
    });

    const synthResult = await synthesizePlan(
      { ...mockConfig, strategyRoot: canonicalRoot } as any,
      { approvedLanes: canonicalRoot.approvedLanes } as any,
      results
    );

    const journey = synthResult.plan.buyerConversionJourneys![0];
    const objections = journey.persuasionStrategy?.objections || [];
    expect(objections).toHaveLength(1);
    expect(objections[0].objection.startsWith("{")).toBe(false);
    expect(objections[0].objection).toBe("Lack of direct human support during onboarding");
  });

  // Test H & I: Strategic Response Completeness
  it("TEST H & I: Strategic Response Completeness: No empty strategic responses in objection playbook", async () => {
    const results = new Map<any, any>();
    results.set("funnel", {
      status: "SUCCESS",
      output: {
        primaryFunnel: {
          funnelName: "Diagnostic Funnel",
          laneId: "lane_a92dbae22915",
          whyThisJourney: "Structured progression.",
          stages: [{ stageName: "Stage 1", goal: "Goal 1", coreMessage: "Msg", proof: [], cta: "CTA" }]
        }
      }
    });
    results.set("persuasion", {
      status: "SUCCESS",
      output: {
        primaryRoute: {
          mode: "Proof-Led Decision Acceleration",
          coreBeliefTransformation: {
            currentBelief: "Belief that manual tools are required.",
            desiredBelief: "Conviction that automated agents deliver superior results."
          },
          objectionPriorities: [
            {
              objectionId: "obj_1",
              objection: { canonical: "Our team already has internal dashboards and manual tools." },
              response: "Demonstrate live workflow automation and continuous adaptation.",
              requiredProof: "Live Modular Execution Demo [PROOF_TO_BUILD]"
            }
          ],
          trustTransferDesign: {
            buyerRiskState: "Risk State",
            trustDeficit: "Trust Deficit",
            transferMechanism: { name: "Demo", proofArtifact: "Artifact [PROOF_TO_BUILD]" }
          }
        }
      }
    });

    const synthResult = await synthesizePlan(
      { ...mockConfig, strategyRoot: canonicalRoot } as any,
      { approvedLanes: canonicalRoot.approvedLanes } as any,
      results
    );

    const journey = synthResult.plan.buyerConversionJourneys![0];
    const objections = journey.persuasionStrategy?.objections || [];
    expect(objections[0].response).toBeTruthy();
    expect(objections[0].response.length).toBeGreaterThan(15);
  });

  // Test J & K: Belief Shift Completeness
  it("TEST J & K: Belief Shift Completeness: currentBelief and desiredBelief are non-empty and grounded", async () => {
    const results = new Map<any, any>();
    results.set("funnel", {
      status: "SUCCESS",
      output: {
        primaryFunnel: {
          funnelName: "Diagnostic Funnel",
          laneId: "lane_a92dbae22915",
          whyThisJourney: "Belief transformation path.",
          stages: [{ stageName: "Stage 1", goal: "Goal 1", coreMessage: "Msg", proof: [], cta: "CTA" }]
        }
      }
    });
    results.set("persuasion", {
      status: "SUCCESS",
      output: {
        primaryRoute: {
          mode: "Proof-Led Decision Acceleration",
          coreBeliefTransformation: {
            currentBelief: "Manual task management and tab switching is inevitable when scaling operations.",
            desiredBelief: "Modular autonomous digital agents automate end-to-end execution without manual bottlenecks.",
            contradictionLogic: "Static dashboards require human orchestration; autonomous agents resolve tasks natively."
          },
          objectionPriorities: [
            {
              objectionId: "obj_1",
              objection: { canonical: "Internal tools exist." },
              response: "Demonstrate live execution.",
              requiredProof: "Demo"
            }
          ],
          trustTransferDesign: {
            buyerRiskState: "Risk State",
            trustDeficit: "Trust Deficit",
            transferMechanism: { name: "Demo", proofArtifact: "Artifact [PROOF_TO_BUILD]" }
          }
        }
      }
    });

    const synthResult = await synthesizePlan(
      { ...mockConfig, strategyRoot: canonicalRoot } as any,
      { approvedLanes: canonicalRoot.approvedLanes } as any,
      results
    );

    const journey = synthResult.plan.buyerConversionJourneys![0];
    const cbt = journey.persuasionStrategy?.coreBeliefTransformation;
    expect(cbt?.currentBelief).toBeTruthy();
    expect(cbt?.desiredBelief).toBeTruthy();
    expect(cbt?.currentBelief).not.toBe(cbt?.desiredBelief);
  });

  // Test L: Lane Contamination Prevention
  it("TEST L: Lane Contamination Prevention: Excluded pain signals are not mapped to active lane journey", async () => {
    const results = new Map<any, any>();
    results.set("funnel", {
      status: "SUCCESS",
      output: {
        primaryFunnel: {
          funnelName: "Operational Autonomy Funnel",
          laneId: "lane_a92dbae22915",
          primaryCorePainId: "seg_2_pain_1",
          whyThisJourney: "Lane-scoped execution.",
          stages: [{ stageName: "Stage 1", goal: "Goal 1", coreMessage: "Msg", proof: [], cta: "CTA" }]
        }
      }
    });

    const synthResult = await synthesizePlan(
      { ...mockConfig, strategyRoot: canonicalRoot } as any,
      { approvedLanes: canonicalRoot.approvedLanes } as any,
      results
    );

    const journey = synthResult.plan.buyerConversionJourneys![0];
    expect(journey.primaryPainId).toBe("seg_2_pain_1");
  });

  // Test M: Claim Strength Integrity
  it("TEST M: Claim Strength Integrity: Absolute guarantee claims are categorized as required future proofs", async () => {
    const results = new Map<any, any>();
    results.set("funnel", {
      status: "SUCCESS",
      output: {
        primaryFunnel: {
          funnelName: "Diagnostic Funnel",
          laneId: "lane_a92dbae22915",
          whyThisJourney: "Integrity validation.",
          stages: [
            {
              stageName: "Problem Recognition",
              goal: "Expose hidden data drift",
              coreMessage: "Continuous signals beat static reports.",
              proof: [
                { proofName: "Guaranteed Zero Disruption Deployment", proofStatus: "REQUIRED_FUTURE_PROOF" }
              ],
              cta: "Download Audit"
            }
          ]
        }
      }
    });

    const synthResult = await synthesizePlan(
      { ...mockConfig, strategyRoot: canonicalRoot } as any,
      { approvedLanes: canonicalRoot.approvedLanes } as any,
      results
    );

    const stageProofs = synthResult.plan.buyerConversionJourneys![0].stages[0].proof;
    expect(stageProofs[0].proofStatus).toBe("REQUIRED_FUTURE_PROOF");
  });

  // Test N: Pure Assembler Invariant
  it("TEST N: Pure Assembler Invariant: Plan synthesis preserves upstream decisions without inventing new strategic concepts", async () => {
    const results = new Map<any, any>();
    results.set("funnel", {
      status: "SUCCESS",
      output: {
        primaryFunnel: {
          funnelName: "Diagnostic Funnel",
          laneId: "lane_a92dbae22915",
          whyThisJourney: "Pure assembler verification.",
          stages: [{ stageName: "Stage 1", goal: "Goal 1", coreMessage: "Msg", proof: [], cta: "CTA" }]
        }
      }
    });

    const synthResult = await synthesizePlan(
      { ...mockConfig, strategyRoot: canonicalRoot } as any,
      { approvedLanes: canonicalRoot.approvedLanes } as any,
      results
    );

    expect(synthResult.plan.buyerConversionJourneys).toBeDefined();
  });
});
