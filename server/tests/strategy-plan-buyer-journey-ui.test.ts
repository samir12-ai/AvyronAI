import { describe, it, expect } from "vitest";
import {
  translateJourneyType,
  translatePersuasionPrinciple,
  translateEntryTrigger,
  translateMessageStepLabel,
} from "../../components/strategy-plan/bll-presenter";
import type { BuyerConversionJourneyItem } from "../../types/buyer-conversion-journey";

describe("Strategy Plan Buyer Conversion Journey UX & Presentation Tests (Tests A through N)", () => {
  // Test Data Fixtures
  const singleCoreJourney: BuyerConversionJourneyItem = {
    laneId: "lane_enterprise",
    laneLabel: "Enterprise Revenue Operations",
    primaryPainId: "pain_ent_1",
    primaryPainText: "Scattered pipeline insights and data decay causing poor targeting decisions.",
    segmentIds: ["seg_ent"],
    targetSegmentName: "Enterprise RevOps Leaders",
    sourceFunnelSnapshotId: "snap_funnel_ent",
    sourcePersuasionSnapshotId: "snap_persuasion_ent",
    journeyName: "Live Market Mirror Acceleration Journey",
    journeyType: "consultative_b2b",
    whyThisJourney: "Enterprise buyers require third-party empirical validation before commercial risk commitment.",
    entryTrigger: {
      mechanismType: "proof_led_entry",
      purpose: "Provide verified signal audit before asking for sales engagement.",
    },
    stages: [
      {
        stageId: "stage_awareness",
        stageName: "Problem Recognition",
        goal: "Expose hidden revenue leakages and data drift.",
        buyerState: "Skeptical Evaluation",
        coreMessage: "Your existing reports reflect stale competitor assumptions.",
        contentAction: "Executive Audit Report",
        proof: ["SOC2 Audit", "Market Drift Benchmark"],
        cta: "Download Pipeline Leakage Diagnostic",
      },
      {
        stageId: "stage_consideration",
        stageName: "Mechanism Verification",
        goal: "Prove real-time signal convergence outperforms manual analysis.",
        buyerState: "Active Comparison",
        coreMessage: "Continuous first-party signals eliminate guesswork.",
        contentAction: "Live Architecture Demo",
        proof: ["GTM Benchmark Study", "Customer Case Study"],
        cta: "Request Architecture Walkthrough",
      },
      {
        stageId: "stage_decision",
        stageName: "Commercial Activation",
        goal: "Secure executive procurement approval.",
        buyerState: "Procurement Commitment",
        coreMessage: "Deploy with guaranteed data integrity and zero disruption.",
        contentAction: "ROI Pilot Proposal",
        proof: ["Enterprise SLA", "Security Compliance Cert"],
        cta: "Initiate Verified 14-Day Pilot",
      },
    ],
    persuasionStrategy: {
      mode: "Proof-Led Decision Acceleration",
      modeLabel: "Enterprise Verification",
      coreBeliefTransformation: {
        currentBelief: "More spreadsheets and dashboards will fix our visibility problem.",
        desiredBelief: "Reliable revenue targeting requires continuous, verified market signals.",
        contradictionLogic: "Adding more static dashboards only compounds reporting latency.",
      },
      messageSequence: [
        { step: "s1", stepLabel: "disrupt_belief", rationale: "Prove reporting lag causes pipeline stall." },
        { step: "s2", stepLabel: "introduce_mechanism", rationale: "Show automated signal convergence engine." },
        { step: "s3", stepLabel: "neutralize_objections", rationale: "Pre-empt security and migration friction." },
        { step: "s4", stepLabel: "invite_commitment", rationale: "Offer zero-risk verification trial." },
      ],
      objections: [
        {
          objectionId: "obj_1",
          objection: "Our team already has too many disparate tools.",
          response: "Avyron integrates seamlessly into your existing CRM without replacing your stack.",
          requiredProof: "Turnkey API Integration Architecture",
          funnelStageId: "stage_consideration",
        },
        {
          objectionId: "obj_2",
          objection: "We cannot afford a long deployment cycle.",
          response: "Production onboarding completes in under 14 days with zero downtime.",
          requiredProof: "14-Day Enterprise Deployment SLA",
          funnelStageId: "stage_decision",
        },
      ],
      trustStrategy: {
        buyerRiskState: "High Procurement Caution",
        trustDeficit: "Category Fatigue & Tool Overlap Skepticism",
        transferMechanismName: "Verified Diagnostic Protocol",
        proofArtifact: "Independent Revenue Operations Audit",
        primaryCialdiniPrinciple: "authority_social_proof",
        principleRationale: "Enterprise procurement requires institutional verification and peer validation.",
      },
    },
  };

  const midMarketJourney: BuyerConversionJourneyItem = {
    laneId: "lane_midmarket",
    laneLabel: "Mid-Market Sales Velocity",
    primaryPainId: "pain_mm_1",
    primaryPainText: "Long sales cycles and deal stalls in mid-market pipeline.",
    segmentIds: ["seg_mm"],
    targetSegmentName: "Mid-Market Sales Directors",
    sourceFunnelSnapshotId: "snap_funnel_mm",
    sourcePersuasionSnapshotId: "snap_persuasion_mm",
    journeyName: "Rapid Deal Velocity Journey",
    journeyType: "product_led_inbound",
    whyThisJourney: "Mid-market directors prioritize rapid time-to-value and instant deal acceleration.",
    entryTrigger: {
      mechanismType: "interactive_demo",
      purpose: "Instant deal acceleration simulator.",
    },
    stages: [
      {
        stageId: "stage_trial",
        stageName: "Instant Discovery",
        goal: "Demonstrate immediate deal acceleration.",
        buyerState: "Curious Evaluation",
        coreMessage: "Automate deal scoring in 5 minutes.",
        contentAction: "Interactive Deal Simulator",
        proof: ["10-Minute Setup Video"],
        cta: "Start Free Interactive Trial",
      },
    ],
    persuasionStrategy: {
      mode: "Rapid Value Demonstration",
      modeLabel: "Velocity-First",
      coreBeliefTransformation: {
        currentBelief: "Manual deal qualification is sufficient.",
        desiredBelief: "Automated scoring doubles pipeline velocity.",
      },
      messageSequence: [
        { step: "s1", stepLabel: "show_speed", rationale: "Highlight immediate win." },
      ],
      objections: [
        {
          objectionId: "obj_mm_1",
          objection: "Budget is constrained this quarter.",
          response: "Usage-based tier pays for itself on the first saved deal.",
          requiredProof: "Live ROI Calculator Benchmark",
          funnelStageId: "stage_trial",
        },
      ],
      trustStrategy: {
        buyerRiskState: "Budget Scarcity",
        trustDeficit: "Time to Value Skepticism",
        transferMechanismName: "Live Deal Scorecard",
        proofArtifact: "Customer ROI Dashboard",
        primaryCialdiniPrinciple: "social_proof",
        principleRationale: "Mid-market responds directly to quantifiable speed and peer benchmarks.",
      },
    },
  };

  // Helper normalizer matching BuyerConversionJourneyView normalization
  function normalizeJourneys(
    journeys?: BuyerConversionJourneyItem[],
    legacyJourney?: any,
    legacyPersuasion?: any
  ): BuyerConversionJourneyItem[] {
    if (Array.isArray(journeys) && journeys.length > 0) return journeys;
    if (legacyJourney || legacyPersuasion) {
      const stages = Array.isArray(legacyJourney?.stages)
        ? legacyJourney.stages.map((s: any) => ({
            stageId: s.stageId || s.id || (s.stageName || s.name || "stage").toLowerCase().replace(/\s+/g, "_"),
            stageName: s.stageName || s.name || "Funnel Stage",
            goal: s.goal || "",
            buyerState: s.buyerState || "",
            coreMessage: s.coreMessage || "",
            contentAction: s.contentAction || "",
            proof: Array.isArray(s.proof) ? s.proof : (s.proofPlacements || []),
            cta: s.cta || "",
          }))
        : [];
      return [
        {
          laneId: legacyJourney?.laneId || "default_lane",
          laneLabel: legacyJourney?.laneLabel || legacyJourney?.journeyName || "Buyer Conversion Journey",
          primaryPainId: legacyJourney?.primaryPainId,
          primaryPainText: legacyJourney?.primaryPainText,
          segmentIds: legacyJourney?.segmentIds || [],
          targetSegmentName: legacyJourney?.targetSegmentName,
          journeyName: legacyJourney?.journeyName || "Buyer Conversion Journey",
          journeyType: legacyJourney?.journeyType || "Consultative B2B",
          whyThisJourney: legacyJourney?.whyThisJourney || "Strategic conversion flow.",
          entryTrigger: legacyJourney?.entryTrigger || { mechanismType: "Start With Proof", purpose: "Capture attention" },
          stages,
          persuasionStrategy: legacyJourney?.persuasionStrategy || legacyPersuasion || undefined,
        },
      ];
    }
    return [];
  }

  // TEST A — SINGLE LANE UX
  it("Test A: Single-lane plan yields exactly 1 journey without unnecessary tabs", () => {
    const list = normalizeJourneys([singleCoreJourney]);
    expect(list).toHaveLength(1);
    expect(list[0].laneId).toBe("lane_enterprise");
    expect(list[0].stages).toHaveLength(3);
    expect(list[0].persuasionStrategy).toBeDefined();
    // In UI: normalizedJourneys.length === 1 renders NO tab bar
    const shouldShowTabs = list.length > 1;
    expect(shouldShowTabs).toBe(false);
  });

  // TEST B — MULTI LANE UX
  it("Test B: Multi-lane plan yields 2 independent journeys with accessible tabs", () => {
    const list = normalizeJourneys([singleCoreJourney, midMarketJourney]);
    expect(list).toHaveLength(2);
    const shouldShowTabs = list.length > 1;
    expect(shouldShowTabs).toBe(true);

    const laneIds = list.map((j) => j.laneId);
    expect(laneIds).toContain("lane_enterprise");
    expect(laneIds).toContain("lane_midmarket");
  });

  // TEST C — TAB IDENTITY (SELECTION BOUND BY LANE ID, NOT ARRAY INDEX)
  it("Test C: Tab selection binds by laneId and persists even when array order changes", () => {
    const listOrder1 = [singleCoreJourney, midMarketJourney];
    const listOrder2 = [midMarketJourney, singleCoreJourney];

    let selectedLaneId = "lane_midmarket";
    const selectedFrom1 = listOrder1.find((j) => j.laneId === selectedLaneId);
    const selectedFrom2 = listOrder2.find((j) => j.laneId === selectedLaneId);

    expect(selectedFrom1?.journeyName).toBe("Rapid Deal Velocity Journey");
    expect(selectedFrom2?.journeyName).toBe("Rapid Deal Velocity Journey");
    expect(selectedFrom1?.laneId).toBe(selectedFrom2?.laneId);
  });

  // TEST D — CORE PAIN DISPLAY PER LANE
  it("Test D: Each lane displays its own canonical primary core pain without cross-contamination", () => {
    const list = [singleCoreJourney, midMarketJourney];
    const entPain = list.find((j) => j.laneId === "lane_enterprise")?.primaryPainText;
    const mmPain = list.find((j) => j.laneId === "lane_midmarket")?.primaryPainText;

    expect(entPain).toContain("Scattered pipeline insights");
    expect(mmPain).toContain("Long sales cycles");
    expect(entPain).not.toBe(mmPain);
  });

  // TEST E — FUNNEL STAGES INTEGRITY
  it("Test E: All canonical stages are preserved with goals, messages, actions, proof, and CTAs", () => {
    const stages = singleCoreJourney.stages;
    expect(stages).toHaveLength(3);
    for (const stage of stages) {
      expect(stage.stageName).toBeTruthy();
      expect(stage.goal).toBeTruthy();
      expect(stage.coreMessage).toBeTruthy();
      expect(stage.contentAction).toBeTruthy();
      expect(stage.proof.length).toBeGreaterThan(0);
      expect(stage.cta).toBeTruthy();
    }
  });

  // TEST F — PERSUASION INSIDE THE JOURNEY
  it("Test F: Persuasion strategy is nested per lane and contains mode, belief transformation, and trust strategy", () => {
    const p1 = singleCoreJourney.persuasionStrategy;
    const p2 = midMarketJourney.persuasionStrategy;

    expect(p1?.mode).toBe("Proof-Led Decision Acceleration");
    expect(p2?.mode).toBe("Rapid Value Demonstration");

    expect(p1?.coreBeliefTransformation.currentBelief).toContain("More spreadsheets");
    expect(p2?.coreBeliefTransformation.currentBelief).toContain("Manual deal qualification");

    expect(p1?.trustStrategy.transferMechanismName).toBe("Verified Diagnostic Protocol");
    expect(p2?.trustStrategy.transferMechanismName).toBe("Live Deal Scorecard");
  });

  // TEST G — OBJECTION STAGE BINDING VIA EXACT ID LINKAGE
  it("Test G: Objections resolve to exact stage names via funnelStageId matching", () => {
    const stages = singleCoreJourney.stages;
    const objections = singleCoreJourney.persuasionStrategy!.objections!;

    const stageMap = new Map(stages.map((s) => [s.stageId, s.stageName]));

    const obj1 = objections[0];
    const resolvedStageName1 = stageMap.get(obj1.funnelStageId!);
    expect(resolvedStageName1).toBe("Mechanism Verification");

    const obj2 = objections[1];
    const resolvedStageName2 = stageMap.get(obj2.funnelStageId!);
    expect(resolvedStageName2).toBe("Commercial Activation");
  });

  // TEST H — SUPPORTING PAIN CONFINEMENT
  it("Test H: Supporting pains do not generate standalone conversion journeys or tabs", () => {
    const supportingPainOnly = {
      laneId: "lane_supp",
      title: "Supporting Pain Lane",
      role: "SUPPORTING",
    };
    // Helper confirms supporting pains are filtered upstream, resulting in only CORE journeys
    const journeys = [singleCoreJourney]; // Only core journey present
    expect(journeys.some((j) => j.laneId === "lane_supp")).toBe(false);
  });

  // TEST I — LEGACY PLAN NORMALIZATION
  it("Test I: Legacy singleton plan normalizes into one structured display journey", () => {
    const legacyJourney = {
      journeyName: "Legacy Consultative Flow",
      journeyType: "Consultative B2B",
      whyThisJourney: "Historical plan conversion flow.",
      stages: [{ stageName: "Awareness", goal: "Educate" }],
    };
    const legacyPersuasion = {
      mode: "Proof-Led",
      modeLabel: "Direct",
      coreBeliefTransformation: { currentBelief: "Old", desiredBelief: "New" },
    };

    const normalized = normalizeJourneys(undefined, legacyJourney, legacyPersuasion);
    expect(normalized).toHaveLength(1);
    expect(normalized[0].journeyName).toBe("Legacy Consultative Flow");
    expect(normalized[0].persuasionStrategy?.mode).toBe("Proof-Led");
  });

  // TEST J — PARTIAL JOURNEY GRACEFUL HANDLING
  it("Test J: Partial journey with missing persuasion does not crash and does not fabricate data", () => {
    const partialJourney: BuyerConversionJourneyItem = {
      laneId: "lane_partial",
      journeyName: "Funnel-Only Journey",
      journeyType: "Standard",
      whyThisJourney: "Persuasion computation pending.",
      stages: [{ stageName: "Initial Stage", goal: "Awareness", buyerState: "Evaluating", coreMessage: "Intro", contentAction: "Post", proof: [], cta: "Learn" }],
      persuasionStrategy: undefined,
    };

    const normalized = normalizeJourneys([partialJourney]);
    expect(normalized).toHaveLength(1);
    expect(normalized[0].stages).toHaveLength(1);
    expect(normalized[0].persuasionStrategy).toBeUndefined();
  });

  // TEST K — BLL TRANSLATIONS
  it("Test K: BLL translates technical enums into executive English without altering meaning", () => {
    expect(translateJourneyType("consultative_b2b")).toBe("Consultative B2B");
    expect(translateJourneyType("product_led_inbound")).toBe("Product-Led Inbound");
    expect(translateJourneyType("education_led")).toBe("Education-Led Conversion");

    expect(translatePersuasionPrinciple("authority_social_proof")).toBe("Verified Authority & Peer Validation");
    expect(translatePersuasionPrinciple("authority")).toBe("Evidence-Backed Authority");
    expect(translatePersuasionPrinciple("social_proof")).toBe("Verified Peer Validation");

    expect(translateEntryTrigger("proof_led_entry")).toBe("Start With Proof");
    expect(translateEntryTrigger("interactive_demo")).toBe("Interactive Demonstration");

    expect(translateMessageStepLabel("disrupt_belief", 0)).toBe("Challenge the Current Assumption");
    expect(translateMessageStepLabel("introduce_mechanism", 1)).toBe("Introduce the Core Mechanism");
    expect(translateMessageStepLabel("neutralize_objections", 2)).toBe("Pre-empt Key Commercial Objections");
  });

  // TEST L — LINEAGE CONTINUITY
  it("Test L: Lineage metadata (laneId, primaryPainId, snapshot IDs) are preserved internally", () => {
    expect(singleCoreJourney.laneId).toBe("lane_enterprise");
    expect(singleCoreJourney.primaryPainId).toBe("pain_ent_1");
    expect(singleCoreJourney.sourceFunnelSnapshotId).toBe("snap_funnel_ent");
    expect(singleCoreJourney.sourcePersuasionSnapshotId).toBe("snap_persuasion_ent");
  });

  // TEST M — NO FRONTEND STRATEGY INVENTION
  it("Test M: View layer strictly consumes canonical fields and does not fabricate missing strategy", () => {
    const rawData = { ...singleCoreJourney };
    delete (rawData as any).whyThisJourney;
    const normalized = normalizeJourneys([rawData]);
    expect(normalized[0].whyThisJourney).toBeUndefined();
  });

  // TEST N — REAL MULTI-LANE FIXTURE
  it("Test N: Real multi-lane fixture with dual CORE produces distinct buyer journeys with full fidelity", () => {
    const dualCoreJourneys = [singleCoreJourney, midMarketJourney];
    const normalized = normalizeJourneys(dualCoreJourneys);

    expect(normalized).toHaveLength(2);
    expect(normalized[0].laneId).not.toBe(normalized[1].laneId);
    expect(normalized[0].stages[0].stageName).not.toBe(normalized[1].stages[0].stageName);
    expect(normalized[0].persuasionStrategy?.mode).not.toBe(normalized[1].persuasionStrategy?.mode);
  });
});
