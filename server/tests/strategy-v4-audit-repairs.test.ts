import { describe, it, expect } from "vitest";
import {
  extractCanonicalCompetitorPositioningClaims,
  assessCompetitorRelationshipClass,
  sanitizeTerritoryName,
} from "../positioning-engine/engine";
import { computeSemanticCollisions } from "../positioning-engine/semantic-collision";
import { buildFunnelCandidate } from "../funnel-engine/engine";
import { attachAELGrounding, resolveTargetLaneAndSegment } from "../persuasion-engine/engine";
import { matchResumeDecision } from "../orchestrator/resume-hydration";
import { translateStrategyPlanToBusinessLanguage } from "../core/business-language-layer";
import { validateCrossEngineStrategyConsistency } from "../orchestrator/plan-synthesis";

describe("Strategy Pipeline v4 Audit Repairs — Tenant-Neutral Regression Suite", () => {
  it("1. Populated competitor evidence reaches comparison across CU, MI competitorData, and multiSourceSignals (Songai & Non-Songai B2B fixture)", () => {
    // Fixture A: Personalized digital song context
    const songaiClaims = extractCanonicalCompetitorPositioningClaims({
      competitors: [
        { id: "comp_1", name: "Songfinch", businessType: "Custom song platform" },
        { id: "comp_2", name: "Moonpig", businessType: "Personalized greeting cards and gifts" },
      ],
      cuSnapshots: [
        {
          id: "cu_snap_1",
          competitorId: "comp_1",
          competitorName: "Songfinch",
          competitorUnderstanding: JSON.stringify({
            offers: [{ offerName: "Original Custom Song", description: "Radio-quality custom song by real artists in 4-7 days" }],
            positioning: [{ claim: "Turn your memories into a radio-quality original song crafted by independent musicians." }],
          }),
        },
      ],
      miSnapshot: {
        competitorData: JSON.stringify([
          {
            competitorId: "comp_2",
            competitorName: "Moonpig",
            commercialFacts: {
              positioning: "Personalised cards, flowers, and thoughtful occasion gifts delivered across the UK.",
              offers: ["Personalised greeting cards", "Gift bundles"],
            },
          },
        ]),
        multiSourceSignals: JSON.stringify({
          Songfinch: {
            website: {
              positioningLanguage: ["One-of-a-kind custom music gifts for anniversaries and birthdays"],
            },
          },
        }),
      },
      productDna: {
        coreOffer: "Personalized digital songs generated from buyer stories",
        productCategory: "Digital personalized music gifts",
        coreProblemSolved: "Generic impersonal gifts",
      },
    });

    expect(songaiClaims.length).toBeGreaterThanOrEqual(2);
    const sfClaim = songaiClaims.find((c) => c.competitorId === "comp_1");
    const mpClaim = songaiClaims.find((c) => c.competitorId === "comp_2");
    expect(sfClaim).toBeDefined();
    expect(sfClaim?.relationshipClass).toBe("DIRECT");
    expect(sfClaim?.evidenceSource).toContain("competitor_understanding:cu_snap_1");
    expect(mpClaim).toBeDefined();
    expect(mpClaim?.relationshipClass).toBe("ADJACENT");

    // Fixture B: Non-Songai B2B Clinical Diagnostics / Specialty Coffee fixture
    const b2bClaims = extractCanonicalCompetitorPositioningClaims({
      competitors: [
        { id: "comp_b2b_1", name: "LabFlow Cloud", businessType: "B2B Diagnostic Lab LIMS Software" },
        { id: "comp_b2b_2", name: "MedSupply Direct", businessType: "Clinical Consumables Distributor" },
      ],
      cuSnapshots: [
        {
          id: "cu_b2b_1",
          competitorId: "comp_b2b_1",
          competitorName: "LabFlow Cloud",
          competitorUnderstanding: {
            offers: [{ offerName: "Automated Sample Tracking LIMS", description: "Automated barcode Chain-of-Custody for diagnostic labs" }],
            positioning: [{ claim: "Eliminate manual sample accessioning errors with automated HL7 diagnostic lab workflows." }],
          },
        },
      ],
      miSnapshot: {
        competitorData: [
          {
            competitorId: "comp_b2b_2",
            competitorName: "MedSupply Direct",
            commercialFacts: {
              positioning: "Next-day cold-chain reagent supply for regional pathology clinics.",
            },
          },
        ],
      },
      productDna: {
        coreOffer: "Diagnostic lab workflow automation software with HL7 sample tracking",
        productCategory: "B2B Laboratory Information Management Software",
        coreProblemSolved: "Manual sample accessioning bottlenecks in diagnostic labs",
      },
    });

    expect(b2bClaims.length).toBe(2);
    expect(b2bClaims.find((c) => c.competitorId === "comp_b2b_1")?.relationshipClass).toBe("DIRECT");
    expect(JSON.stringify(b2bClaims)).not.toMatch(/song|mp3|preview|19\.99/i);
  });

  it("2. Empty competitor comparison never becomes verified whitespace", async () => {
    const emptyCollisions = await computeSemanticCollisions({
      territoryClaims: [
        {
          name: "Automated Sample Chain-of-Custody Assurance",
          claimText: "Automated Sample Chain-of-Custody Assurance — Eliminate manual sample accessioning errors",
        },
      ],
      competitorClaims: [],
      accountId: "test_account",
    });

    expect(emptyCollisions).toHaveLength(1);
    expect(emptyCollisions[0].comparisonStatus).toBe("UNVERIFIED_NO_COMPETITOR_CLAIMS");
    expect(emptyCollisions[0].comparedCompetitorCount).toBe(0);
    expect(emptyCollisions[0].collisionMeaning.toLowerCase()).toContain("unverified");
    expect(emptyCollisions[0].collisionMeaning.toLowerCase()).not.toContain("open semantic space");

    // Verify final consistency validator rejects verified whitespace when comparisonStatus is UNVERIFIED_NO_COMPETITOR_CLAIMS
    const results = new Map<any, any>([
      [
        "positioning",
        {
          output: {
            territories: [
              {
                name: "Automated Sample Chain-of-Custody Assurance",
                epistemicStatus: "VERIFIED_FACT",
                semanticCollision: {
                  comparisonStatus: "UNVERIFIED_NO_COMPETITOR_CLAIMS",
                  comparedCompetitorCount: 0,
                  verdict: "CLEAR",
                },
              },
            ],
          },
        },
      ],
    ]);

    const validation = await validateCrossEngineStrategyConsistency(results, {}, "test_account");
    expect(validation.valid).toBe(false);
    expect(validation.conflict).toContain("UNVERIFIED_NO_COMPETITOR_CLAIMS");
  });

  it("3. Generated funnel output survives buildFunnelCandidate without generic stageMap overwrite and stays tenant-neutral", () => {
    const customStages = [
      {
        stage: "entry" as const,
        purpose: "Capture pathology lab directors experiencing accessioning delays",
        coreMessage: "See how automated HL7 barcode intake removes manual sample logging bottlenecks",
        contentStrategy: "Interactive 90-second HL7 intake workflow walkthrough",
        proofType: "process_proof",
        cta: "Watch the HL7 Intake Walkthrough",
      },
      {
        stage: "consideration" as const,
        purpose: "Verify compatibility with existing analyzer instruments",
        coreMessage: "Map your lab's existing analyzer interfaces before committing to deployment",
        contentStrategy: "Analyzer compatibility matrix checker",
        proofType: "capability_proof",
        cta: "Check Your Analyzer Compatibility",
      },
      {
        stage: "conversion" as const,
        purpose: "Complete sandbox configuration for a single lab bench",
        coreMessage: "Validate barcode chain-of-custody on your own test samples",
        contentStrategy: "Guided sandbox onboarding",
        proofType: "demonstration",
        cta: "Launch Your Lab Bench Sandbox",
      },
    ];

    const candidate = buildFunnelCandidate(
      "Lab Director Diagnostic Journey",
      "educational_funnel",
      {
        segments: [{ name: "Pathology Lab Directors", pains: ["Manual accessioning delays"], objections: ["Analyzer compatibility risk"] }],
        pains: ["Manual accessioning delays"],
        desires: ["Zero accessioning backlog"],
        objections: ["Analyzer compatibility risk"],
        awarenessLevel: "problem_aware",
      },
      {
        offerName: "LabFlow Automated Intake Suite",
        valueProposition: "Automated HL7 sample intake for diagnostic labs",
        cta: "Launch Your Lab Bench Sandbox",
      },
      {
        territory: "Automated Sample Chain-of-Custody Assurance",
        narrativeDirection: "Precision HL7 intake",
      },
      {
        pillars: [{ name: "Bi-directional HL7 integration", description: "Direct analyzer sync" }],
      },
      null,
      customStages,
    );

    expect(candidate.stageMap.length).toBeGreaterThanOrEqual(2);
    expect(candidate.stageMap[0].cta).toBe("Watch the HL7 Intake Walkthrough");
    expect(candidate.stageMap[0].coreMessage).toContain("automated HL7 barcode intake");
    expect(JSON.stringify(candidate.stageMap)).not.toMatch(/song|1-minute|mp3|19\.99/i);
  });

  it("4. Unrelated 5% word overlap cannot overwrite or truncate objection responses in attachAELGrounding", () => {
    const fullAuthoritativeResponse =
      "Provide a pre-purchase sample gallery and step-by-step story customization preview so gift buyers can verify vocal style, lyric tone, and genre fit before completing payment, while keeping full custom production clear and transparent across all stages of checkout.";

    const structuredObjections: any[] = [
      {
        objectionId: "obj_quality_doubt",
        objection: "Fear that an AI-generated song will sound robotic or emotionally flat for an anniversary gift",
        persuasionResponse: fullAuthoritativeResponse,
        resolution: fullAuthoritativeResponse,
        response: fullAuthoritativeResponse,
        subjectScope: "SELF_PRODUCT",
      },
    ];

    // Unrelated root cause that shares only 1 generic token ("gift" -> ~7% overlap)
    const ael: any = {
      rootCauses: [
        {
          id: "rc_unrelated_delivery",
          rootCause: "Post-purchase gift download link email landed in spam folder after checkout",
        },
      ],
    };

    const routes: any[] = [];
    attachAELGrounding(routes, structuredObjections, ael);

    expect(structuredObjections[0].persuasionResponse).toBe(fullAuthoritativeResponse);
    expect(structuredObjections[0].resolution).toBe(fullAuthoritativeResponse);
    expect(structuredObjections[0].persuasionResponse).not.toContain("Resolve by addressing:");
    expect(structuredObjections[0].aelGrounding).toBeUndefined();
  });

  it("5. Proposal status and epistemic status survive BusinessLanguageLayer without silent semantic regex rewriting", async () => {
    const planInput = {
      strategicSummary: {
        strategy: "Position around customizable story-driven song creation with verified pre-payment audio preview.",
        targetAudience: "Gift buyers seeking personal keepsakes for milestone occasions.",
        growthObjective: "Acquire gift buyers through public audio examples and story intake.",
        rationale: "Focus on verified story-input workflow rather than unverified turnaround guarantees.",
        proposalStatus: "STRATEGIC_HYPOTHESIS",
        epistemicStatus: "STRATEGIC_HYPOTHESIS",
        verificationStatus: "PROPOSED",
      },
      monthlyObjective: {
        objective: "Validate conversion rate on customizable song gift landing page.",
      },
      contentDistribution: {
        rationale: "Demonstrate real audio examples across occasion segments.",
        contentPillars: [{ pillar: "Occasion Story Examples", examples: ["Anniversary tribute example"] }],
      },
      executionBlueprintDnaLink: {
        contentPillarToDna: [{ pillar: "Occasion Story Examples", hookApproach: "Occasion milestone hook", ctaStyle: "Start your story configuration" }],
        weeklyDnaApplication: "Consistent occasion-based audio demonstrations.",
      },
    };

    const rep = await translateStrategyPlanToBusinessLanguage(planInput, "test_account");
    expect(rep.strategicSummary.proposalStatus).toBe("STRATEGIC_HYPOTHESIS");
    expect(rep.strategicSummary.epistemicStatus).toBe("STRATEGIC_HYPOTHESIS");
    expect(rep.strategicSummary.verificationStatus).toBe("PROPOSED");
    expect(rep.strategicSummary.strategy).toBe(planInput.strategicSummary.strategy);
  });

  it("6. Missing validation inputs (product facts, lane funnels, or lane persuasions) cannot PASS final validation", async () => {
    const emptyResults = new Map<any, any>();
    const res = await validateCrossEngineStrategyConsistency(emptyResults, {}, "test_account", {
      synthesizedPlan: { buyerConversionJourneys: [] },
      canonicalContext: { productTruth: { verifiedFacts: [] } },
    });

    expect(res.valid).toBe(false);
    expect(res.checkFailed).toBe(true);
    expect(res.conflict).toContain("INCOMPLETE_VALIDATION_INPUTS");
    expect(res.inputCoverage?.passed).toBe(false);
    expect(res.inputCoverage?.missingInputs).toContain("verifiedProductTruthFacts");
    expect(res.inputCoverage?.missingInputs).toContain("laneFunnels");
    expect(res.inputCoverage?.missingInputs).toContain("lanePersuasions");
  });

  it("7. sanitizeTerritoryName is tenant-neutral and prevents brand-failure self-attribution for any brand", () => {
    const b2bSanitized = sanitizeTerritoryName(
      "LabFlow Sample Accessioning Failure System",
      {
        brandName: "LabFlow",
        coreOffer: "Automated HL7 sample tracking",
        productCategory: "Diagnostic Lab Software",
      },
      "Sample accessioning delays",
    );
    expect(b2bSanitized.toLowerCase()).not.toContain("failure system");
    expect(b2bSanitized.toLowerCase()).not.toContain("labflow sample accessioning failure");
    expect(b2bSanitized.toLowerCase()).not.toMatch(/song|mp3|preview/i);
  });

  it("8. Lane IDs and competitor objection attribution survive Persuasion Engine target resolution and resume decision matching", () => {
    const lanes = [
      {
        id: "lane_1",
        laneId: "lane_1",
        name: "Romantic Milestone Gift Buyers",
        segmentIds: ["seg_1"],
        corePainIds: ["pain_1"],
        supportingPainIds: [],
        desires: ["Emotional keepsake"],
        objections: ["Received wrong audio download link from CreateMySong"],
        objectionAttribution: [
          {
            objectionId: "obj_1",
            statement: "Received wrong audio download link from CreateMySong",
            linkedPainId: "pain_1",
            subjectScope: "COMPETITOR_SPECIFIC",
            competitorNames: ["CreateMySong"],
            competitorIds: ["comp_cms"],
            evidenceIds: ["ev_101"],
          },
        ],
      },
      {
        id: "lane_2",
        laneId: "lane_2",
        name: "Family Celebration Buyers",
        segmentIds: ["seg_2"],
        corePainIds: ["pain_2"],
        supportingPainIds: [],
        desires: ["Custom family tribute"],
        objections: ["Unclear revision policy before final download"],
        objectionAttribution: [
          {
            objectionId: "obj_2",
            statement: "Unclear revision policy before final download",
            linkedPainId: "pain_2",
            subjectScope: "UNATTRIBUTED_MARKET",
            competitorNames: [],
            competitorIds: [],
            evidenceIds: ["ev_102"],
          },
        ],
      },
    ];

    const resolvedLane2 = resolveTargetLaneAndSegment(
      {
        approvedLanes: lanes,
        segments: [
          { id: "seg_1", name: "Romantic Milestone Gift Buyers" },
          { id: "seg_2", name: "Family Celebration Buyers" },
        ],
      },
      { laneId: "lane_2" },
    );
    expect(resolvedLane2.targetLane?.id).toBe("lane_2");
    expect(resolvedLane2.targetSegment?.id).toBe("seg_2");
    expect((resolvedLane2.targetLane as any)?.objectionAttribution?.[0]?.objectionId).toBe("obj_2");

    // Verify matchResumeDecision matches by painId across resume runs when audienceSnapshotId matches
    const matchedSpd = matchResumeDecision(
      { painId: "pain_1", canonical: "Difficulty verifying audio quality before purchase" },
      [
        {
          id: "spd_1",
          painId: "pain_1",
          jobId: "job_orig",
          audienceSnapshotId: "aud_snap_1",
          accountId: "acc_1",
          finalClassification: "CORE_PURCHASE",
          payload: {
            painClaim: "Difficulty verifying audio quality before purchase",
          },
        },
      ],
      "job_resume",
      "aud_snap_1",
      "job_orig",
      undefined,
      "acc_1",
    );
    expect(matchedSpd).toBeDefined();
    expect(matchedSpd?.finalClassification).toBe("CORE_PURCHASE");
  });

  it("9. Product truth facts and all multi-lane funnels/persuasions reach final validator inputCoverage & post-BLL check blocks unverified literals", async () => {
    const results = new Map<any, any>([
      [
        "positioning",
        {
          output: {
            territories: [
              {
                name: "Interactive Story-Guided Song Creation",
                epistemicStatus: "STRATEGIC_HYPOTHESIS",
                semanticCollision: {
                  comparisonStatus: "COMPARISON_COMPLETED",
                  comparedCompetitorCount: 5,
                  directCompetitorCount: 4,
                  adjacentCompetitorCount: 1,
                  referenceCompetitorCount: 0,
                  collisionMeaning: "low overlap — comparison completed",
                },
              },
            ],
          },
        },
      ],
    ]);

    const res = await validateCrossEngineStrategyConsistency(results, {}, "test_account", {
      canonicalContext: {
        productTruth: {
          verifiedFacts: [
            { id: "pf_1", claim: "3-step online customization process (story details, genre/mood, custom song generation)" },
            { id: "pf_2", claim: "Free song preview available before payment" },
          ],
        },
      },
      synthesizedPlan: {
        strategicSummary: {
          strategy: "Position around story-guided song creation with £19.99 instant MP3 download and 1-minute preview.",
          rationale: "Capture gift buyers.",
        },
        buyerConversionJourneys: [
          {
            laneId: "lane_1",
            journeyName: "Lane 1 Journey",
            stages: [{ stageName: "Entry", goal: "Capture attention", coreMessage: "Custom story intake", cta: "Start Story Intake" }],
            persuasionStrategy: {
              mode: "Proof-Led",
              coreBeliefTransformation: { currentBelief: "Skeptical", desiredBelief: "Confident" },
              messageSequence: [{ step: "step_1", stepLabel: "Problem Framing", rationale: "Anchor on friction" }],
              objections: [{ objectionId: "obj_1", objection: "Quality doubt", response: "Listen to samples before checkout" }],
            },
          },
          {
            laneId: "lane_2",
            journeyName: "Lane 2 Journey",
            stages: [{ stageName: "Entry", goal: "Capture family gift buyers", coreMessage: "Occasion customization", cta: "Choose Occasion" }],
            persuasionStrategy: {
              mode: "Proof-Led",
              coreBeliefTransformation: { currentBelief: "Uncertain", desiredBelief: "Ready" },
              messageSequence: [{ step: "step_1", stepLabel: "Mechanism Explanation", rationale: "Explain 3-step customization" }],
              objections: [{ objectionId: "obj_2", objection: "Process complexity", response: "Guided 3-step story form" }],
            },
          },
        ],
      },
    });

    // Input coverage must pass with 2 verified facts, 2 lane funnels, and 2 lane persuasions
    expect(res.inputCoverage?.passed).toBe(true);
    expect(res.inputCoverage?.verifiedFactsCount).toBe(2);
    expect(res.inputCoverage?.laneFunnelCount).toBe(2);
    expect(res.inputCoverage?.lanePersuasionCount).toBe(2);
    expect(res.inputCoverage?.competitorComparisonStatus).toBe("COMPARISON_COMPLETED");

    // And post-BLL / displayed summary check must reject the unverified £19.99 and 1-minute preview literals with typed outcome!
    expect(res.valid).toBe(false);
    expect(res.outcomeType).toBe("FAILED_DETERMINISTIC");
    expect(res.blocking).toBe(true);
    expect(res.factualSupport?.unsupportedPromises.length).toBeGreaterThanOrEqual(2);
  });
});
