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
import { designBeliefShift } from "../persuasion-engine/belief-shift";

describe("Strategy Plan Canonical Wiring Hardening (Tests A through N)", () => {
  const mockConfig = { accountId: "acc_1", campaignId: "test_campaign_wiring_hardening", jobId: "job_1" };

  const canonicalRoot = {
    id: "root_canonical_v46",
    campaignId: "test_campaign_wiring_hardening",
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

  // TEST A: Belief Shift Happy Path
  it("TEST A: Belief Shift Happy Path — Persuasion produces valid BeliefShift and Plan receives exact values", async () => {
    const results = new Map<any, any>();
    results.set("funnel", {
      status: "SUCCESS",
      output: {
        primaryFunnel: {
          funnelName: "Operational Autonomy Funnel",
          laneId: "lane_a92dbae22915",
          whyThisJourney: "Structured operational progression from manual task discovery to autonomous execution.",
          stages: [{ stageName: "Problem Recognition", goal: "Expose bottlenecks", coreMessage: "Modular agents automate operations.", proof: [{ proofName: "Live Workflow Demo", proofStatus: "PROOF_TO_BUILD" }], cta: "Run Free Audit" }]
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
              objection: { canonical: "Our team already has internal tools." },
              response: "Demonstrate live workflow execution and automated error recovery.",
              requiredProof: "Live Process Demo [PROOF_TO_BUILD]"
            }
          ],
          trustTransferDesign: {
            buyerRiskState: "Fear of workflow disruption and tool sprawl",
            trustDeficit: "Category skepticism toward black-box AI claims",
            transferMechanism: {
              name: "Transparent Operational Sandbox",
              proofArtifact: "Live Modular Workflow Demo [PROOF_TO_BUILD]"
            }
          },
          cialdiniReasoning: {
            primaryCialdiniPrinciple: "commitment_consistency",
            principleRationale: "Step-by-step diagnostic builds incremental trust."
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
    expect(journey.persuasionStrategy?.coreBeliefTransformation.currentBelief).toBe("Manual task management and tab switching is inevitable when scaling operations.");
    expect(journey.persuasionStrategy?.coreBeliefTransformation.desiredBelief).toBe("Modular autonomous digital agents automate end-to-end execution without manual bottlenecks.");
    expect(journey.persuasionStrategy?.coreBeliefTransformation.contradictionLogic).toBe("Static dashboards require human orchestration; autonomous agents resolve tasks natively.");
  });

  // TEST B & C: Belief Shift Missing / Fail Closed
  it("TEST B & C: Belief Shift Incomplete — Plan Synthesis fails closed if coreBeliefTransformation is missing", async () => {
    const results = new Map<any, any>();
    results.set("funnel", {
      status: "SUCCESS",
      output: {
        primaryFunnel: {
          funnelName: "Operational Autonomy Funnel",
          laneId: "lane_a92dbae22915",
          whyThisJourney: "Structured operational progression.",
          stages: [{ stageName: "Stage 1", goal: "Goal 1", coreMessage: "Msg", proof: [], cta: "CTA" }]
        }
      }
    });
    // Persuasion route is missing coreBeliefTransformation
    results.set("persuasion", {
      status: "SUCCESS",
      output: {
        primaryRoute: {
          mode: "Proof-Led",
          objectionPriorities: [],
        }
      }
    });

    await expect(
      synthesizePlan(
        { ...mockConfig, strategyRoot: canonicalRoot } as any,
        { approvedLanes: canonicalRoot.approvedLanes } as any,
        results
      )
    ).rejects.toThrow(/CONTRACT_INVARIANT_FAILURE.*coreBeliefTransformation/i);
  });

  // TEST D: Objection Response Happy Path
  it("TEST D: Objection Response Happy Path — Plan displays exact semantic responses from Persuasion authority", async () => {
    const results = new Map<any, any>();
    results.set("funnel", {
      status: "SUCCESS",
      output: {
        primaryFunnel: {
          funnelName: "Operational Autonomy Funnel",
          laneId: "lane_a92dbae22915",
          whyThisJourney: "Progressive trust validation.",
          stages: [{ stageName: "Stage 1", goal: "Goal 1", coreMessage: "Msg", proof: [], cta: "CTA" }]
        }
      }
    });
    results.set("persuasion", {
      status: "SUCCESS",
      output: {
        primaryRoute: {
          mode: "Proof-Led",
          coreBeliefTransformation: {
            currentBelief: "Current belief statement that is long enough.",
            desiredBelief: "Desired belief statement that is long enough."
          },
          objectionPriorities: [
            {
              objectionId: "obj_1",
              objection: { canonical: "Lack of direct engineering support" },
              response: "Provide dedicated onboarding engineer and 24/7 SLA.",
              requiredProof: "Onboarding Milestone Blueprint [PROOF_TO_BUILD]"
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

    const objections = synthResult.plan.buyerConversionJourneys![0].persuasionStrategy?.objections || [];
    expect(objections).toHaveLength(1);
    expect(objections[0].objection).toBe("Lack of direct engineering support");
    expect(objections[0].response).toBe("Provide dedicated onboarding engineer and 24/7 SLA.");
  });

  // TEST E & F: Objection Missing Response / Fail Closed
  it("TEST E & F: Objection Missing Response — Plan Synthesis fails closed if objection response is missing", async () => {
    const results = new Map<any, any>();
    results.set("funnel", {
      status: "SUCCESS",
      output: {
        primaryFunnel: {
          funnelName: "Operational Autonomy Funnel",
          laneId: "lane_a92dbae22915",
          whyThisJourney: "Progressive trust validation.",
          stages: [{ stageName: "Stage 1", goal: "Goal 1", coreMessage: "Msg", proof: [], cta: "CTA" }]
        }
      }
    });
    results.set("persuasion", {
      status: "SUCCESS",
      output: {
        primaryRoute: {
          mode: "Proof-Led",
          coreBeliefTransformation: {
            currentBelief: "Current belief statement that is long enough.",
            desiredBelief: "Desired belief statement that is long enough."
          },
          objectionPriorities: [
            {
              objectionId: "obj_1",
              objection: { canonical: "Lack of direct engineering support" },
              response: "", // MISSING RESPONSE
              requiredProof: "Onboarding Blueprint"
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

    await expect(
      synthesizePlan(
        { ...mockConfig, strategyRoot: canonicalRoot } as any,
        { approvedLanes: canonicalRoot.approvedLanes } as any,
        results
      )
    ).rejects.toThrow(/CONTRACT_INVARIANT_FAILURE.*objection response/i);
  });

  // TEST G & H: Proof Authority & BUILD Proof Semantics
  it("TEST G & H: Proof Authority — Upstream proof status is preserved directly without regex alteration", async () => {
    const results = new Map<any, any>();
    results.set("funnel", {
      status: "SUCCESS",
      output: {
        primaryFunnel: {
          funnelName: "Operational Autonomy Funnel",
          laneId: "lane_a92dbae22915",
          whyThisJourney: "Progressive trust validation.",
          stages: [
            {
              stageName: "Evaluation",
              goal: "Demonstrate capability",
              coreMessage: "Workflow validation",
              proof: [
                { proofName: "Live Diagnostic Audit", proofStatus: "PROOF_TO_BUILD", proofType: "diagnostic" },
                { proofName: "Security Blueprint", proofStatus: "REQUIRED_FUTURE_PROOF", proofType: "documentation" }
              ],
              cta: "Learn More"
            }
          ]
        }
      }
    });
    results.set("persuasion", {
      status: "SUCCESS",
      output: {
        primaryRoute: {
          mode: "Proof-Led",
          coreBeliefTransformation: {
            currentBelief: "Current belief statement that is long enough.",
            desiredBelief: "Desired belief statement that is long enough."
          },
          objectionPriorities: [
            {
              objectionId: "obj_1",
              objection: { canonical: "Cost objection" },
              response: "Offer flexible staging.",
              requiredProof: "Staging SLA [PROOF_TO_BUILD]"
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

    const proofs = synthResult.plan.buyerConversionJourneys![0].stages[0].proof;
    expect(proofs[0].proofStatus).toBe("PROOF_TO_BUILD");
    expect(proofs[1].proofStatus).toBe("REQUIRED_FUTURE_PROOF");
  });

  // TEST J: Lane Isolation
  it("TEST J: Lane Isolation — Journeys strictly preserve their lane's segmentIds and primaryPainId", async () => {
    const results = new Map<any, any>();
    results.set("funnel", {
      status: "SUCCESS",
      output: {
        primaryFunnel: {
          funnelName: "Operational Autonomy Funnel",
          laneId: "lane_a92dbae22915",
          primaryCorePainId: "seg_2_pain_1",
          segmentIds: ["seg_f25a4c42a3ac4af4"],
          whyThisJourney: "Lane-specific rationale.",
          stages: [{ stageName: "Stage 1", goal: "Goal 1", coreMessage: "Msg", proof: [], cta: "CTA" }]
        }
      }
    });
    results.set("persuasion", {
      status: "SUCCESS",
      output: {
        primaryRoute: {
          laneId: "lane_a92dbae22915",
          mode: "Proof-Led",
          coreBeliefTransformation: {
            currentBelief: "Current belief statement that is long enough.",
            desiredBelief: "Desired belief statement that is long enough."
          },
          objectionPriorities: [
            { objectionId: "obj_1", objection: { canonical: "Obj" }, response: "Resp", requiredProof: "Proof" }
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
    expect(journey.laneId).toBe("lane_a92dbae22915");
    expect(journey.primaryPainId).toBe("seg_2_pain_1");
    expect(journey.segmentIds).toEqual(["seg_f25a4c42a3ac4af4"]);
  });

  // TEST K: Trust Strategy
  it("TEST K: Trust Strategy — Plan Synthesis fails closed if trustStrategy fields are missing", async () => {
    const results = new Map<any, any>();
    results.set("funnel", {
      status: "SUCCESS",
      output: {
        primaryFunnel: {
          funnelName: "Operational Autonomy Funnel",
          laneId: "lane_a92dbae22915",
          whyThisJourney: "Progressive trust validation.",
          stages: [{ stageName: "Stage 1", goal: "Goal 1", coreMessage: "Msg", proof: [], cta: "CTA" }]
        }
      }
    });
    results.set("persuasion", {
      status: "SUCCESS",
      output: {
        primaryRoute: {
          mode: "Proof-Led",
          coreBeliefTransformation: {
            currentBelief: "Current belief statement that is long enough.",
            desiredBelief: "Desired belief statement that is long enough."
          },
          objectionPriorities: [
            { objectionId: "obj_1", objection: { canonical: "Obj" }, response: "Resp", requiredProof: "Proof" }
          ],
          // Missing trustTransferDesign / trustStrategy
        }
      }
    });

    await expect(
      synthesizePlan(
        { ...mockConfig, strategyRoot: canonicalRoot } as any,
        { approvedLanes: canonicalRoot.approvedLanes } as any,
        results
      )
    ).rejects.toThrow(/CONTRACT_INVARIANT_FAILURE.*trustStrategy/i);
  });

  // TEST L: Objective Provenance
  it("TEST L: Objective Provenance — Growth objective preserves upstream planning status", async () => {
    const results = new Map<any, any>();
    results.set("funnel", {
      status: "SUCCESS",
      output: {
        primaryFunnel: {
          funnelName: "Operational Autonomy Funnel",
          laneId: "lane_a92dbae22915",
          whyThisJourney: "Progressive trust validation.",
          stages: [{ stageName: "Stage 1", goal: "Goal 1", coreMessage: "Msg", proof: [], cta: "CTA" }]
        }
      }
    });
    results.set("persuasion", {
      status: "SUCCESS",
      output: {
        primaryRoute: {
          mode: "Proof-Led",
          coreBeliefTransformation: {
            currentBelief: "Current belief statement that is long enough.",
            desiredBelief: "Desired belief statement that is long enough."
          },
          objectionPriorities: [
            { objectionId: "obj_1", objection: { canonical: "Obj" }, response: "Resp", requiredProof: "Proof" }
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

    expect(synthResult.plan.strategicSummary.growthObjective).toBeDefined();
    expect(synthResult.plan.kpiStructure.primaryKPI.name).toBeDefined();
  });

  // TEST M: Plan Synthesis Pure Assembler Invariant
  it("TEST M: Plan Synthesis Pure Assembler — Plan Synthesis does not invent missing whyThisJourney", async () => {
    const results = new Map<any, any>();
    results.set("funnel", {
      status: "SUCCESS",
      output: {
        primaryFunnel: {
          funnelName: "Operational Autonomy Funnel",
          laneId: "lane_a92dbae22915",
          whyThisJourney: "", // MISSING WHY THIS JOURNEY
          stages: [{ stageName: "Stage 1", goal: "Goal 1", coreMessage: "Msg", proof: [], cta: "CTA" }]
        }
      }
    });
    results.set("persuasion", {
      status: "SUCCESS",
      output: {
        primaryRoute: {
          mode: "Proof-Led",
          coreBeliefTransformation: {
            currentBelief: "Current belief statement that is long enough.",
            desiredBelief: "Desired belief statement that is long enough."
          },
          objectionPriorities: [
            { objectionId: "obj_1", objection: { canonical: "Obj" }, response: "Resp", requiredProof: "Proof" }
          ],
          trustTransferDesign: {
            buyerRiskState: "Risk State",
            trustDeficit: "Trust Deficit",
            transferMechanism: { name: "Demo", proofArtifact: "Artifact [PROOF_TO_BUILD]" }
          }
        }
      }
    });

    await expect(
      synthesizePlan(
        { ...mockConfig, strategyRoot: canonicalRoot } as any,
        { approvedLanes: canonicalRoot.approvedLanes } as any,
        results
      )
    ).rejects.toThrow(/CONTRACT_INVARIANT_FAILURE.*whyThisJourney/i);
  });

  // TEST N: Zero Semantic Fallbacks
  it("TEST N: Zero Semantic Fallbacks — Runtime verification that Plan Synthesis strictly passes through upstream objects", async () => {
    const results = new Map<any, any>();
    results.set("funnel", {
      status: "SUCCESS",
      output: {
        primaryFunnel: {
          funnelName: "Specific Funnel",
          laneId: "lane_a92dbae22915",
          whyThisJourney: "Specific upstream why text.",
          stages: [{ stageName: "Stage 1", goal: "Goal 1", coreMessage: "Msg", proof: [], cta: "CTA" }]
        }
      }
    });
    results.set("persuasion", {
      status: "SUCCESS",
      output: {
        primaryRoute: {
          mode: "Proof-Led",
          coreBeliefTransformation: {
            currentBelief: "Specific current belief from persuasion engine.",
            desiredBelief: "Specific desired belief from persuasion engine."
          },
          objectionPriorities: [
            { objectionId: "obj_1", objection: { canonical: "Specific objection text" }, response: "Specific upstream response", requiredProof: "Specific proof [PROOF_TO_BUILD]" }
          ],
          trustTransferDesign: {
            buyerRiskState: "Specific buyer risk state",
            trustDeficit: "Specific trust deficit",
            transferMechanism: { name: "Specific mechanism", proofArtifact: "Specific proof artifact" }
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
    expect(journey.whyThisJourney).toBe("Specific upstream why text.");
    expect(journey.persuasionStrategy?.coreBeliefTransformation.currentBelief).toBe("Specific current belief from persuasion engine.");
    expect(journey.persuasionStrategy?.coreBeliefTransformation.desiredBelief).toBe("Specific desired belief from persuasion engine.");
    expect(journey.persuasionStrategy?.objections[0].response).toBe("Specific upstream response");
    expect(journey.persuasionStrategy?.trustStrategy.buyerRiskState).toBe("Specific buyer risk state");
  });
});
