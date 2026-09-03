import { describe, it, expect, vi } from "vitest";

vi.mock("../db", () => {
  const dummyChain: any = {
    select: () => dummyChain,
    from: () => dummyChain,
    where: () => dummyChain,
    limit: () => Promise.resolve([{
      id: "bdl_1",
      businessType: "B2B SaaS AI Platform",
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

describe("Strategy Plan Authority, Claim Gate & Proof Model Tests (Tests A through L)", () => {
  const mockConfig = { accountId: "acc_1", campaignId: "test_campaign_authority_repair", jobId: "job_1" };

  // Test A: Production Lane Authority - 1 Approved Lane = Exactly 1 Buyer Conversion Journey
  it("TEST A: Production Lane Authority: Strategy Root with 1 executable lane produces exactly 1 Buyer Conversion Journey", async () => {
    const singleLaneRoot = {
      id: "root_single_lane",
      campaignId: "test_campaign_authority_repair",
      primaryAxis: "Fragmented Insight Pipeline Hindering Targeting",
      contrastAxisText: "Live continuous market intelligence vs static defensive reporting",
      approvedLanes: [
        {
          laneId: "lane_3507f25bfd04",
          title: "B2B SaaS Buyers Seeking Data Quality and GTM Effectiveness",
          primaryPainId: "seg_3_pain_1",
          corePainIds: ["seg_3_pain_1", "seg_2_pain_1"],
          segmentIds: ["seg_3"],
        }
      ]
    };

    const mockFunnelResult = {
      status: "SUCCESS",
      snapshotId: "snap_fn_canonical_1",
      output: {
        primaryFunnel: {
          funnelName: "Avyron AI Strategic Intelligence Funnel",
          funnelType: "consultative_b2b",
          laneId: "lane_3507f25bfd04",
          primaryCorePainId: "seg_3_pain_1",
          segmentIds: ["seg_3"],
          whyThisJourney: "Structured operational progression from manual task discovery to autonomous execution.",
          stages: [
            {
              stageId: "stage_diagnose",
              stageName: "Problem Recognition",
              goal: "Expose fragmented intelligence gaps",
              buyerState: "Skeptical Evaluation",
              coreMessage: "Static reporting creates targeting blindness.",
              contentAction: "Live Signal Audit",
              proof: ["Live Market Mirror Architecture Demo"],
              cta: "Run Free Intelligence Diagnostic",
            }
          ]
        },
      }
    };

    const mockPersuasionResult = {
      status: "SUCCESS",
      snapshotId: "snap_pr_canonical_1",
      output: {
        primaryRoute: {
          mode: "Proof-Led Decision Acceleration",
          modeLabel: "Direct & Verified",
          coreBeliefTransformation: {
            currentBelief: "Manual reporting and static market research are sufficient for GTM targeting.",
            desiredBelief: "Continuous, verified market intelligence is required for precise targeting.",
          },
          messageSequence: [
            { step: "s1", stepLabel: "disrupt_belief", rationale: "Expose latency in static data." }
          ],
          objections: [
            {
              objectionId: "obj_1",
              objection: "Our team already has internal dashboards.",
              response: "Internal dashboards lack continuous live competitor tracking.",
              requiredProof: "Live Market Mirror Verification Benchmark",
            }
          ],
          trustStrategy: {
            buyerRiskState: "Cautious Evaluation",
            trustDeficit: "Category Fatigue",
            transferMechanismName: "Diagnostic Protocol",
            proofArtifact: "Live Market Mirror Diagnostic Audit",
            primaryCialdiniPrinciple: "authority_social_proof",
            principleRationale: "Operational demonstration proves efficacy.",
          }
        },
      }
    };

    const results = new Map<any, any>();
    results.set("funnel", mockFunnelResult);
    results.set("persuasion", mockPersuasionResult);

    const synthResult = await synthesizePlan(
      { ...mockConfig, strategyRoot: singleLaneRoot } as any,
      { approvedLanes: singleLaneRoot.approvedLanes } as any,
      results
    );

    expect(synthResult.plan.buyerConversionJourneys).toBeDefined();
    expect(synthResult.plan.buyerConversionJourneys).toHaveLength(1);
    expect(synthResult.plan.buyerConversionJourneys![0].laneId).toBe("lane_3507f25bfd04");
    expect(synthResult.plan.buyerConversionJourneys![0].laneLabel).toBe("B2B SaaS Buyers Seeking Data Quality and GTM Effectiveness");
  });

  // Test B: No Fixture Injection - Unapproved fixture lane IDs are rejected
  it("TEST B: No Fixture Injection: Unapproved test fixture lane IDs (lane_enterprise, lane_midmarket) are rejected", async () => {
    const canonicalRoot = {
      id: "root_canonical",
      campaignId: "test_campaign_authority_repair",
      approvedLanes: [
        {
          laneId: "lane_3507f25bfd04",
          title: "B2B SaaS Buyers Seeking Data Quality and GTM Effectiveness",
          primaryPainId: "seg_3_pain_1",
          corePainIds: ["seg_3_pain_1"],
          segmentIds: ["seg_3"],
        }
      ]
    };

    // Inject unapproved funnels from test fixtures
    const funnelsMap = new Map<string, any>();
    funnelsMap.set("lane_enterprise", {
      status: "SUCCESS",
      snapshotId: "snap_fn_ent_mock",
      output: {
        primaryFunnel: {
          funnelName: "Enterprise RevOps Acceleration Funnel",
          laneId: "lane_enterprise",
          whyThisJourney: "Enterprise journey rationale.",
          stages: [{ stageName: "Stage 1", goal: "Goal 1", coreMessage: "Msg", proof: ["SOC2 Audit"], cta: "CTA" }]
        },
      }
    });
    funnelsMap.set("lane_midmarket", {
      status: "SUCCESS",
      snapshotId: "snap_fn_mm_mock",
      output: {
        primaryFunnel: {
          funnelName: "Mid-Market Sales Funnel",
          laneId: "lane_midmarket",
          whyThisJourney: "Midmarket journey rationale.",
          stages: [{ stageName: "Stage 1", goal: "Goal 1", coreMessage: "Msg", proof: ["10-Min Video"], cta: "CTA" }]
        },
      }
    });

    const results = new Map<any, any>();
    results.set("funnels", funnelsMap);

    const synthResult = await synthesizePlan(
      { ...mockConfig, strategyRoot: canonicalRoot } as any,
      { approvedLanes: canonicalRoot.approvedLanes } as any,
      results
    );

    // Unapproved lanes must NOT appear in buyerConversionJourneys
    expect(synthResult.plan.buyerConversionJourneys).toBeDefined();
    const laneIds = synthResult.plan.buyerConversionJourneys!.map(j => j.laneId);
    expect(laneIds).not.toContain("lane_enterprise");
    expect(laneIds).not.toContain("lane_midmarket");
  });

  // Test C: Buyer Continuity
  it("TEST C: Buyer Continuity: Target segment and audience remain aligned with canonical audience", async () => {
    const root = {
      id: "root_1",
      campaignId: "test_campaign_authority_repair",
      approvedLanes: [
        {
          laneId: "lane_3507f25bfd04",
          title: "B2B SaaS Buyers Seeking Data Quality and GTM Effectiveness",
          primaryPainId: "seg_3_pain_1",
          corePainIds: ["seg_3_pain_1"],
          segmentIds: ["seg_3"],
        }
      ]
    };

    const results = new Map<any, any>();
    results.set("funnel", {
      status: "SUCCESS",
      output: {
        primaryFunnel: {
          funnelName: "GTM Intelligence Funnel",
          laneId: "lane_3507f25bfd04",
          whyThisJourney: "Continuity-driven conversion progression.",
          stages: [{ stageName: "Awareness", goal: "Expose data decay", coreMessage: "Signals beat guesses", proof: [], cta: "Audit" }]
        }
      }
    });

    const synthResult = await synthesizePlan(
      { ...mockConfig, strategyRoot: root } as any,
      { approvedLanes: root.approvedLanes } as any,
      results
    );

    expect(synthResult.plan.buyerConversionJourneys![0].laneId).toBe("lane_3507f25bfd04");
    expect(synthResult.plan.buyerConversionJourneys![0].laneLabel).toBe("B2B SaaS Buyers Seeking Data Quality and GTM Effectiveness");
  });

  // Test D: Excluded Pain - Billing/Refund solutions are removed from content pillars
  it("TEST D: Excluded Pain: Excluded billing/refund pains cannot become Avyron product capabilities or content pillars", async () => {
    const root = {
      id: "root_1",
      campaignId: "test_campaign_authority_repair",
      approvedLanes: [{ laneId: "lane_3507f25bfd04", title: "B2B SaaS Buyers Seeking Data Quality" }]
    };

    const results = new Map<any, any>();
    results.set("funnel", {
      status: "SUCCESS",
      output: {
        primaryFunnel: {
          funnelName: "Funnel 1",
          whyThisJourney: "Grounded journey rationale.",
          stages: [{ stageName: "Stage 1", goal: "Goal 1", coreMessage: "Msg", proof: [], cta: "CTA" }]
        }
      }
    });

    const synthResult = await synthesizePlan(
      { ...mockConfig, strategyRoot: root } as any,
      { approvedLanes: root.approvedLanes } as any,
      results
    );

    const pillars = synthResult.plan.contentDistribution.contentPillars || [];
    for (const p of pillars) {
      expect(p.pillar).not.toMatch(/Billing and Service Trust Repair Process/i);
      expect(p.pillar).not.toMatch(/refund dashboard/i);
    }
  });

  // Test E: Market Observation
  it("TEST E: Market Observation: Competitor billing complaints may be observed in market intelligence without becoming product capabilities", async () => {
    const root = {
      id: "root_1",
      campaignId: "test_campaign_authority_repair",
      approvedLanes: [{ laneId: "lane_3507f25bfd04", title: "B2B SaaS Data Quality" }]
    };

    const results = new Map<any, any>();
    results.set("market_intelligence", {
      status: "SUCCESS",
      output: {
        crossSignalDecisions: {
          decisions: [
            {
              id: "dec_1",
              type: "VALIDATED_PAIN",
              signalText: "Competitor users frequently complain about refund delays and billing opacity",
              confidenceLevel: "HIGH"
            }
          ]
        }
      }
    });
    results.set("funnel", {
      status: "SUCCESS",
      output: {
        primaryFunnel: {
          funnelName: "Diagnostic Funnel",
          whyThisJourney: "Continuous validated intelligence ensures targeting accuracy.",
          stages: [{ stageName: "Stage 1", goal: "Expose static data drift", coreMessage: "Msg", proof: [], cta: "CTA" }]
        }
      }
    });

    const synthResult = await synthesizePlan(
      { ...mockConfig, strategyRoot: root } as any,
      { approvedLanes: root.approvedLanes } as any,
      results
    );

    expect(synthResult.plan).toBeDefined();
    expect(synthResult.plan.strategicSummary.strategy).not.toMatch(/within billing and customer service workflows/i);
  });

  // Test F & G: Product Claim Gate & Proof Status Model
  it("TEST F & G: Product Claim Gate & Proof Status: Proof items preserve upstream status directly", async () => {
    const root = {
      id: "root_1",
      campaignId: "test_campaign_authority_repair",
      approvedLanes: [{ laneId: "lane_3507f25bfd04", title: "B2B SaaS Data Quality" }]
    };

    const results = new Map<any, any>();
    results.set("funnel", {
      status: "SUCCESS",
      output: {
        primaryFunnel: {
          funnelName: "Diagnostic Funnel",
          laneId: "lane_3507f25bfd04",
          whyThisJourney: "Evidence-backed validation.",
          stages: [
            {
              stageName: "Problem Recognition",
              goal: "Expose hidden data drift",
              coreMessage: "Continuous signals beat static reports.",
              proof: [
                { proofName: "Enterprise Security & Compliance Documentation", proofStatus: "REQUIRED_FUTURE_PROOF" },
                { proofName: "Targeting Precision Improvement Benchmark", proofStatus: "REQUIRED_FUTURE_PROOF" },
                { proofName: "Live Market Mirror Architecture Demo", proofStatus: "ESTABLISHED_PROOF" }
              ],
              cta: "Download Audit"
            },
            {
              stageName: "Commercial Activation",
              goal: "Procurement commitment",
              coreMessage: "Deploy with guaranteed data integrity",
              proof: [
                { proofName: "Onboarding & Deployment Milestone Schedule", proofStatus: "REQUIRED_FUTURE_PROOF" },
                { proofName: "Standard Data Protection Agreement", proofStatus: "REQUIRED_FUTURE_PROOF" }
              ],
              cta: "Start Pilot"
            }
          ]
        }
      }
    });

    const synthResult = await synthesizePlan(
      { ...mockConfig, strategyRoot: root } as any,
      { approvedLanes: root.approvedLanes } as any,
      results
    );

    const journey = synthResult.plan.buyerConversionJourneys![0];
    const stage1Proofs = journey.stages[0].proof;
    const stage2Proofs = journey.stages[1].proof;

    expect(stage1Proofs[0].proofStatus).toBe("REQUIRED_FUTURE_PROOF");
    expect(stage1Proofs[1].proofStatus).toBe("REQUIRED_FUTURE_PROOF");
    expect(stage1Proofs[2].proofStatus).toBe("ESTABLISHED_PROOF");
    expect(stage2Proofs[0].proofStatus).toBe("REQUIRED_FUTURE_PROOF");
  });

  // Test H: Awareness Grounding
  it("TEST H: Awareness Grounding: Narrative reframe centers on static intelligence vs continuous verified evidence", async () => {
    const root = {
      id: "root_1",
      campaignId: "test_campaign_authority_repair",
      approvedLanes: [{ laneId: "lane_3507f25bfd04", title: "B2B SaaS Data Quality" }]
    };

    const results = new Map<any, any>();
    results.set("funnel", {
      status: "SUCCESS",
      output: {
        primaryFunnel: {
          funnelName: "Funnel 1",
          whyThisJourney: "Continuous verified intelligence transformation.",
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
            currentBelief: "Static research reports and manual spreadsheets are sufficient for targeting.",
            desiredBelief: "Continuous live market intelligence is required for precise targeting."
          },
          objections: [],
          trustStrategy: {
            buyerRiskState: "Risk State",
            trustDeficit: "Trust Deficit",
            transferMechanismName: "Demo",
            proofArtifact: "Artifact [PROOF_TO_BUILD]",
            primaryCialdiniPrinciple: "authority_social_proof",
            principleRationale: "Validation proves value"
          }
        }
      }
    });

    const synthResult = await synthesizePlan(
      { ...mockConfig, strategyRoot: root } as any,
      { approvedLanes: root.approvedLanes } as any,
      results
    );

    const journey = synthResult.plan.buyerConversionJourneys![0];
    expect(journey.persuasionStrategy?.coreBeliefTransformation.currentBelief).toContain("Static research reports");
    expect(journey.persuasionStrategy?.coreBeliefTransformation.desiredBelief).toContain("Continuous live market intelligence");
  });

  // Test I & J: Canonical Funnel & Persuasion Binding
  it("TEST I & J: Canonical Funnel & Persuasion Binding: Journey binds to real snapshot IDs and preserves stage flow", async () => {
    const root = {
      id: "root_1",
      campaignId: "test_campaign_authority_repair",
      approvedLanes: [{ laneId: "lane_3507f25bfd04", title: "B2B SaaS Data Quality" }]
    };

    const results = new Map<any, any>();
    results.set("funnel", {
      status: "SUCCESS",
      snapshotId: "snap_fn_real_123",
      output: {
        primaryFunnel: {
          funnelName: "Canonical Funnel Flow",
          whyThisJourney: "Two-stage diagnostic to demo journey.",
          stages: [
            { stageId: "s_diag", stageName: "Diagnose", goal: "Audit data quality", coreMessage: "Msg", proof: [], cta: "CTA 1" },
            { stageId: "s_demo", stageName: "Demonstrate", goal: "Show live mirror", coreMessage: "Msg", proof: [], cta: "CTA 2" }
          ]
        },
      }
    });
    results.set("persuasion", {
      status: "SUCCESS",
      snapshotId: "snap_pr_real_123",
      output: {
        primaryRoute: {
          mode: "Proof-Led",
          coreBeliefTransformation: {
            currentBelief: "Manual reporting is adequate.",
            desiredBelief: "Continuous intelligence is necessary."
          },
          trustStrategy: {
            buyerRiskState: "Cautious",
            trustDeficit: "Skepticism",
            transferMechanismName: "Live Verification",
            proofArtifact: "Diagnostic Protocol",
            primaryCialdiniPrinciple: "authority_social_proof",
            principleRationale: "Validation proves value"
          }
        },
      }
    });

    const synthResult = await synthesizePlan(
      { ...mockConfig, strategyRoot: root } as any,
      { approvedLanes: root.approvedLanes } as any,
      results
    );

    const journey = synthResult.plan.buyerConversionJourneys![0];
    expect(journey.sourceFunnelSnapshotId).toBe("snap_fn_real_123");
    expect(journey.sourcePersuasionSnapshotId).toBe("snap_pr_real_123");
    expect(journey.stages).toHaveLength(2);
    expect(journey.stages[0].stageName).toBe("Diagnose");
    expect(journey.stages[1].stageName).toBe("Demonstrate");
  });

  // Test K: Plan Lineage
  it("TEST K: Plan Lineage: Plan sections come from compatible campaign authority without test fixture mixing", async () => {
    const root = {
      id: "root_1",
      campaignId: "test_campaign_authority_repair",
      approvedLanes: [{ laneId: "lane_3507f25bfd04", title: "B2B SaaS Data Quality" }]
    };

    const results = new Map<any, any>();
    results.set("funnel", {
      status: "SUCCESS",
      snapshotId: "snap_fn_clean",
      output: {
        primaryFunnel: {
          funnelName: "Canonical Funnel",
          laneId: "lane_3507f25bfd04",
          whyThisJourney: "Clean lineage validation.",
          stages: [{ stageName: "Stage 1", goal: "Goal 1", coreMessage: "Msg", proof: [], cta: "CTA" }]
        },
      }
    });

    const synthResult = await synthesizePlan(
      { ...mockConfig, strategyRoot: root } as any,
      { approvedLanes: root.approvedLanes } as any,
      results
    );

    expect(synthResult.plan.buyerConversionJourneys).toHaveLength(1);
    expect(synthResult.plan.approvedLanes).toHaveLength(1);
    expect(synthResult.plan.buyerConversionJourneys![0].laneId).toBe(synthResult.plan.approvedLanes![0].laneId);
  });
});
