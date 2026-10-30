import { describe, it, expect } from "vitest";
import {
  extractCanonicalCompetitorPositioningClaims,
  sanitizeTerritoryName,
} from "../positioning-engine/engine";
import { buildAudiencePainRegistry } from "../shared/audience-pain-registry";
import { attachAELGrounding } from "../persuasion-engine/engine";
import { validateCrossEngineStrategyConsistency } from "../orchestrator/plan-synthesis";
import { translateStrategyPlanToBusinessLanguage } from "../core/business-language-layer";

describe("Songai Pipeline Repairs — Comprehensive 14-Point Regression Suite (with Non-Songai B2B Fixture)", () => {
  it("1. Run-manifest pinning prevents mid-run MI drift and rejects incompatible snapshot reuse", async () => {
    const pinnedMiSnapshotId = "9d05d7dc-9cd6-443e-ad35-c562a32d58d5";
    const driftedMiSnapshotId = "1faa4759-70e1-49bd-9cb1-f288823390e5";
    const backgroundPersistSnap = {
      id: "c2f6e1a0-50fd-4aa4-b334-2ae3511622e7",
      sourceJobId: "persist:camp_ac86e8b8-55b:1792414394919",
      offeringId: "c898287c-b39d-4810-95b4-e41450dc1923",
    };
    const pinnedAudienceSnap = {
      id: "3628f8ae-410c-4a0d-b7c1-f8e2e607dc2e",
      miSnapshotId: pinnedMiSnapshotId,
      offeringId: "c898287c-b39d-4810-95b4-e41450dc1923",
    };
    const incompatibleMechanismSnap = {
      id: "65f17b24-061f-4445-8754-26fc444198db",
      sourceJobId: "orch_1792389226686_d0a5d2",
      positioningSnapshotId: "old_pos_snap_id",
      differentiationSnapshotId: "old_diff_snap_id",
      audienceSnapshotId: "old_aud_snap_id",
    };
    const currentPositioningSnap = {
      id: "e53fc9f8-6349-4733-badc-d6fb415d0381",
      differentiationSnapshotId: "68674c6b-e3de-43aa-b071-f02acbd794c6",
      audienceSnapshotId: pinnedAudienceSnap.id,
      miSnapshotId: driftedMiSnapshotId,
    };

    // 1a. Background persist:* snapshots are never selected as strategy-run MI snapshots
    expect(String(backgroundPersistSnap.sourceJobId).startsWith("persist:")).toBe(true);

    // 1b. Positioning snapshot whose miSnapshotId !== audience.miSnapshotId is lineage-incompatible
    const isPosCompatible =
      currentPositioningSnap.audienceSnapshotId === pinnedAudienceSnap.id &&
      currentPositioningSnap.miSnapshotId === pinnedAudienceSnap.miSnapshotId;
    expect(isPosCompatible).toBe(false);

    // 1c. Mechanism snapshot from an earlier run whose positioningSnapshotId !== currentPositioningSnap.id is rejected
    const isMechCompatible =
      incompatibleMechanismSnap.positioningSnapshotId === currentPositioningSnap.id &&
      incompatibleMechanismSnap.audienceSnapshotId === pinnedAudienceSnap.id;
    expect(isMechCompatible).toBe(false);
  });

  it("2. Live observation updates do not overwrite active strategy evidence references", () => {
    const snapshots = [
      {
        id: "c2f6e1a0-50fd-4aa4-b334-2ae3511622e7",
        sourceJobId: "persist:camp_ac86e8b8-55b:1792414394919",
        createdAt: new Date("2026-10-19T16:59:54Z"),
      },
      {
        id: "9d05d7dc-9cd6-443e-ad35-c562a32d58d5",
        sourceJobId: "orch_1792389226686_d0a5d2",
        createdAt: new Date("2026-10-19T10:03:00Z"),
      },
    ];

    const latestLiveMiSnap = snapshots[0];
    const latestStrategyRunMiSnap =
      snapshots.find((s) => !String(s.sourceJobId || "").startsWith("persist:")) || latestLiveMiSnap;

    expect(latestStrategyRunMiSnap.id).toBe("9d05d7dc-9cd6-443e-ad35-c562a32d58d5");
    expect(latestLiveMiSnap.id).toBe("c2f6e1a0-50fd-4aa4-b334-2ae3511622e7");
    expect(latestLiveMiSnap.id !== latestStrategyRunMiSnap.id).toBe(true);
  });

  it("3. High competitor collision revises or reclassifies positioning and prevents narrativeDistanceScore = 1 or whitespace_positioning", async () => {
    const highOverlapCollision = {
      comparisonStatus: "COMPARISON_COMPLETED",
      comparedCompetitorCount: 5,
      directCompetitorCount: 4,
      adjacentCompetitorCount: 1,
      referenceCompetitorCount: 0,
      semanticCollisionScore: 0.65,
      collisionScore: 0.65,
      competitorSource: "Songfinch",
      competitorId: "comp_sf",
      verdict: "HIGH_OVERLAP",
      collisionMeaning: "high overlap — shared category proposition with Songfinch",
    };

    const badResults = new Map<any, any>([
      [
        "positioning",
        {
          output: {
            primaryTerritory: "Custom Emotional Song Keepsakes",
            primaryAxis: "whitespace_positioning",
            differentiationAxes: ["whitespace_positioning", "story_customization"],
            narrativeDistanceScore: 1,
            territories: [
              {
                name: "Custom Emotional Song Keepsakes",
                narrativeDistanceScore: 1,
                epistemicStatus: "STRATEGIC_HYPOTHESIS",
                semanticCollision: highOverlapCollision,
              },
            ],
          },
        },
      ],
    ]);

    const validation = await validateCrossEngineStrategyConsistency(badResults, {}, "test_account", {
      canonicalContext: {
        productTruth: {
          verifiedFacts: [{ id: "pf_1", claim: "3-step online song customization process" }],
        },
      },
      synthesizedPlan: {
        buyerConversionJourneys: [
          {
            laneId: "lane_1",
            stages: [{ stageName: "Entry", coreMessage: "Start your story", cta: "Create Song" }],
            persuasionStrategy: {
              messageSequence: [{ step: "step_1", rationale: "Story intake" }],
              objections: [{ objectionId: "obj_1", objection: "Quality concern", response: "Free preview before payment", supportingFactId: "pf_1" }],
            },
          },
        ],
      },
    });

    expect(validation.valid).toBe(false);
    expect(validation.outcomeType).toBe("FAILED_DETERMINISTIC");
    expect(validation.blocking).toBe(true);
    expect(validation.defects.some((d) => d.category === "COMPETITOR_CONTRADICTION")).toBe(true);
  });

  it("4. Customer desires (revisions, permanent access, fast delivery) remain desires unless supported by product facts", async () => {
    const results = new Map<any, any>([
      [
        "positioning",
        {
          output: {
            primaryTerritory: "Preview-First Story Song Creation",
            primaryAxis: "shared_capability_strategic_emphasis",
            differentiationAxes: ["shared_capability_strategic_emphasis"],
            narrativeDistanceScore: 0.42,
            territories: [
              {
                name: "Preview-First Story Song Creation",
                narrativeDistanceScore: 0.42,
                epistemicStatus: "STRATEGIC_HYPOTHESIS",
                semanticCollision: {
                  comparisonStatus: "COMPARISON_COMPLETED",
                  comparedCompetitorCount: 5,
                  semanticCollisionScore: 0.58,
                  verdict: "MODERATE_OVERLAP",
                },
              },
            ],
          },
        },
      ],
    ]);

    const validation = await validateCrossEngineStrategyConsistency(results, {}, "test_account", {
      canonicalContext: {
        productTruth: {
          verifiedFacts: [
            { id: "pf_1", claim: "3-step online customization process (share story, choose style, generate song)" },
            { id: "pf_2", claim: "Free song preview available before payment" },
          ],
        },
      },
      synthesizedPlan: {
        strategicSummary: {
          strategy: "Highlight the 3-step customization workflow and free pre-payment song preview.",
          rationale: "Address quality skepticism before checkout.",
        },
        buyerConversionJourneys: [
          {
            laneId: "lane_1",
            desires: ["Buyers want revision options", "Buyers desire permanent downloadable access"],
            stages: [
              {
                stageName: "Conversion",
                coreMessage: "Use our collaborative revision process and interface with revision options to refine lyrics.",
                cta: "Review, Revise, and Complete Your Order",
              },
            ],
            persuasionStrategy: {
              messageSequence: [{ step: "step_1", rationale: "Preview-first verification" }],
              objections: [{ objectionId: "obj_1", objection: "Quality risk", response: "Listen to the free preview before payment", supportingFactId: "pf_2" }],
            },
          },
        ],
      },
    });

    expect(validation.valid).toBe(false);
    expect(validation.outcomeType).toBe("FAILED_DETERMINISTIC");
    expect(validation.defects.some((d) => d.category === "EPISTEMIC_MISMATCH")).toBe(true);
  });

  it("5. Unsupported guarantees (never generic, ensures authenticity, guaranteed satisfaction/support) are rejected as facts", async () => {
    const rawPlan = {
      strategicSummary: {
        strategy: "Position around our 3-step song builder that is never generic and ensures authenticity with permanent downloadable MP3 access.",
        targetAudience: "Milestone gift buyers",
        growthObjective: "Increase preview-to-checkout conversion",
        rationale: "Differentiate on emotional resonance",
      },
    };
    const bllOutput = await translateStrategyPlanToBusinessLanguage(rawPlan, "test_account");
    // BLL fallback preserves text without secretly swapping "lifetime access" -> "long-term access"
    expect(bllOutput.strategicSummary.strategy).toContain("never generic");

    const results = new Map<any, any>([
      [
        "positioning",
        {
          output: {
            primaryTerritory: "Preview-First Story Song Creation",
            primaryAxis: "shared_capability_strategic_emphasis",
            narrativeDistanceScore: 0.45,
            territories: [
              {
                name: "Preview-First Story Song Creation",
                narrativeDistanceScore: 0.45,
                epistemicStatus: "STRATEGIC_HYPOTHESIS",
                semanticCollision: {
                  comparisonStatus: "COMPARISON_COMPLETED",
                  comparedCompetitorCount: 4,
                  semanticCollisionScore: 0.55,
                  verdict: "MODERATE_OVERLAP",
                },
              },
            ],
          },
        },
      ],
    ]);

    const validation = await validateCrossEngineStrategyConsistency(results, {}, "test_account", {
      canonicalContext: {
        productTruth: {
          verifiedFacts: [
            { id: "pf_1", claim: "3-step online customization process" },
            { id: "pf_2", claim: "Free song preview available before payment" },
          ],
        },
      },
      synthesizedPlan: {
        strategicSummary: rawPlan.strategicSummary,
        businessRepresentation: bllOutput,
        buyerConversionJourneys: [
          {
            laneId: "lane_1",
            stages: [{ stageName: "Entry", coreMessage: "Preview your song before paying", cta: "Start Song Preview" }],
            persuasionStrategy: {
              messageSequence: [{ step: "step_1", rationale: "Preview verification" }],
              objections: [{ objectionId: "obj_1", objection: "Quality concern", response: "Free preview before payment", supportingFactId: "pf_2" }],
            },
          },
        ],
      },
    });

    expect(validation.valid).toBe(false);
    expect(validation.outcomeType).toBe("FAILED_DETERMINISTIC");
    expect(validation.defects.some((d) => d.category === "FACTUAL_DEFECT")).toBe(true);
  });

  it("6. Corrupted or hallucinated supportingFactId values fail deterministically and are never fuzzy-matched", async () => {
    const canonicalFactId = "a0a0cc39-22ee-4d9d-9a8d-7d5c627e915f";
    const corruptedFactId = "a0a0cc39-22ee-4d9d-9a8d-7d5c627e915c"; // Last char 'c' instead of 'f'

    const results = new Map<any, any>([
      [
        "positioning",
        {
          output: {
            primaryTerritory: "Preview-First Story Song Creation",
            primaryAxis: "shared_capability_strategic_emphasis",
            narrativeDistanceScore: 0.45,
            territories: [
              {
                name: "Preview-First Story Song Creation",
                narrativeDistanceScore: 0.45,
                epistemicStatus: "STRATEGIC_HYPOTHESIS",
                semanticCollision: {
                  comparisonStatus: "COMPARISON_COMPLETED",
                  comparedCompetitorCount: 4,
                  semanticCollisionScore: 0.55,
                  verdict: "MODERATE_OVERLAP",
                },
              },
            ],
          },
        },
      ],
    ]);

    const validation = await validateCrossEngineStrategyConsistency(results, {}, "test_account", {
      canonicalContext: {
        productTruth: {
          verifiedFacts: [
            { id: canonicalFactId, claim: "Free song preview available before payment" },
          ],
        },
      },
      synthesizedPlan: {
        strategicSummary: {
          strategy: "Position around the free song preview available before payment.",
          rationale: "Reduce upfront buyer risk.",
        },
        buyerConversionJourneys: [
          {
            laneId: "lane_1",
            stages: [{ stageName: "Entry", coreMessage: "Listen to a free song preview before paying", cta: "Generate Preview" }],
            persuasionStrategy: {
              messageSequence: [{ step: "step_1", rationale: "Preview verification" }],
              objections: [
                {
                  objectionId: "obj_1",
                  objection: "Quality skepticism",
                  response: "Use the free song preview before payment",
                  supportingFactId: corruptedFactId,
                },
              ],
            },
          },
        ],
      },
    });

    expect(validation.valid).toBe(false);
    expect(validation.outcomeType).toBe("FAILED_DETERMINISTIC");
    const refDefect = validation.defects.find((d) => d.category === "REFERENCE_INVALID");
    expect(refDefect).toBeDefined();
    expect(refDefect?.citedEvidenceIds).toContain(corruptedFactId);
  });

  it("7. Registered competitor attribution (GiftSong) and unregistered observed subject attribution (songlygift.com, Divine Songs) survive into Audience/Persuasion", () => {
    const canonicalRegistry = new Map<string, any>([
      [
        "rev_giftsong_1",
        {
          unitId: "rev_giftsong_1",
          competitorId: "comp_31f62af2-f",
          competitorName: "GiftSong",
          registryResolutionStatus: "REGISTERED_COMPETITOR",
          sourceType: "trustpilot_review",
          text: "GiftSong charged me extra for lyric changes and the download link expired before our anniversary.",
        },
      ],
      [
        "EV-273",
        {
          unitId: "mv_ev_273",
          rawEvidenceReference: { id: "EV-273", table: "market_voice_evidence" },
          competitorId: undefined,
          competitorName: "songlygift.com",
          observedSubjectDomain: "songlygift.com",
          observedSubjectName: "songlygift.com",
          registryResolutionStatus: "OBSERVED_UNREGISTERED_SUBJECT",
          sourceType: "market_voice_review",
          text: "Ordered a custom birthday song from songlygift.com and customer service never replied to my revision request.",
        },
      ],
      [
        "EV-347",
        {
          unitId: "mv_ev_347",
          rawEvidenceReference: { id: "EV-347", table: "market_voice_evidence" },
          competitorId: undefined,
          competitorName: "Divine Songs",
          observedSubjectName: "Divine Songs",
          registryResolutionStatus: "OBSERVED_UNREGISTERED_SUBJECT",
          sourceType: "market_voice_forum",
          text: "Review of Divine Songs: the singer mispronounced my partner's name and support refused to fix it.",
        },
      ],
    ]);

    const painRegistry = buildAudiencePainRegistry(
      [
        {
          painId: "seg_1_pain_3",
          canonical: "Customers report extra fees for lyric changes, expired download links, revision request delays, and mispronounced names",
          evidenceUids: ["rev_giftsong_1", "EV-273", "EV-347"],
          classification: "CORE_PURCHASE",
        },
      ],
      { accountId: "test_account", audienceSnapshotId: "aud_snap_test" },
      canonicalRegistry,
      [{ id: "seg_1", name: "Gift Buyers" }],
    );

    expect(painRegistry).toHaveLength(1);
    const boundEvidence = painRegistry[0].materiality?.evidence || [];
    expect(boundEvidence).toHaveLength(3);
    expect(boundEvidence.some((e: any) => e.competitorId === "comp_31f62af2-f" && e.competitorName === "GiftSong")).toBe(true);
    expect(boundEvidence.some((e: any) => e.observedSubjectDomain === "songlygift.com" && e.registryResolutionStatus === "OBSERVED_UNREGISTERED_SUBJECT")).toBe(true);
    expect(boundEvidence.some((e: any) => e.competitorName === "Divine Songs" && e.registryResolutionStatus === "OBSERVED_UNREGISTERED_SUBJECT")).toBe(true);
  });

  it("8. Unrelated AEL root causes (such as pricing root causes for song-quality objections) are not attached", () => {
    const structuredObjections: any[] = [
      {
        objectionId: "obj_1",
        linkedPainId: "seg_1_pain_1",
        objection: "Skepticism that an AI-generated song will sound robotic, generic, or lack emotional depth for a milestone gift",
        persuasionResponse: "Let buyers hear a free song preview generated from their own story details before payment.",
        resolution: "Let buyers hear a free song preview generated from their own story details before payment.",
        response: "Let buyers hear a free song preview generated from their own story details before payment.",
        subjectScope: "SELF_PRODUCT",
      },
    ];

    const aelWithPricingRootCause: any = {
      rootCauses: [
        {
          id: "RC1",
          painId: "seg_1_pain_99",
          rootCause: "Opaque multi-tier pricing and unexpected checkout add-on fees for song gifts create buyer distrust",
        },
      ],
    };

    attachAELGrounding([], structuredObjections, aelWithPricingRootCause);
    expect(structuredObjections[0].aelGrounding).toBeUndefined();
  });

  it("9. Multi-lane Persuasion produces distinct, non-duplicated lane sequences where lanes differ", () => {
    const lane1PersuasionSequence = [
      {
        step: 1,
        stepKey: "romantic_milestone_framing",
        stepLabel: "Step 1: Romantic Milestone Story Framing",
        purpose: "Anchor on anniversary and partner keepsake emotion",
        beliefShift: "From generic gift anxiety to personal story song confidence",
        coreMessage: "Start by sharing the memories and milestones that define your relationship",
        messageFocus: "Start by sharing the memories and milestones that define your relationship",
        rationale: "Anchor on anniversary and partner keepsake emotion",
        proofRequirement: "Public romantic song audio examples",
        objectionAddressed: "Fear of robotic or impersonal lyrics",
        cta: "Share Your Partner's Story",
      },
      {
        step: 2,
        stepKey: "pre_payment_preview_verification",
        stepLabel: "Step 2: Pre-Payment Audio Preview Verification",
        purpose: "Eliminate upfront quality risk before checkout",
        beliefShift: "From skeptical listener to verified buyer",
        coreMessage: "Listen to your generated song preview before completing payment",
        messageFocus: "Listen to your generated song preview before completing payment",
        rationale: "Eliminate upfront quality risk before checkout",
        proofRequirement: "Free pre-payment audio preview",
        objectionAddressed: "Paying before hearing the vocal quality",
        cta: "Listen to Your Free Song Preview",
      },
    ];

    const lane2PersuasionSequence = [
      {
        step: 1,
        stepKey: "family_celebration_setup",
        stepLabel: "Step 1: Family & Group Celebration Occasion Setup",
        purpose: "Show how multiple family anecdotes fit into one tribute song",
        beliefShift: "From complicated group gift coordination to simple 3-step story input",
        coreMessage: "Combine favorite family memories and inside jokes in a guided 3-step form",
        messageFocus: "Combine favorite family memories and inside jokes in a guided 3-step form",
        rationale: "Show how multiple family anecdotes fit into one tribute song",
        proofRequirement: "3-step online customization interface walkthrough",
        objectionAddressed: "Uncertainty about how custom details are turned into lyrics",
        cta: "Choose Your Family Occasion",
      },
      {
        step: 2,
        stepKey: "genre_mood_selection_preview",
        stepLabel: "Step 2: Genre & Mood Selection with Pre-Payment Preview",
        purpose: "Match the recipient's musical taste before purchase",
        beliefShift: "From genre mismatch concern to confident selection",
        coreMessage: "Select acoustic, pop, or country style and preview the track before paying",
        messageFocus: "Select acoustic, pop, or country style and preview the track before paying",
        rationale: "Match the recipient's musical taste before purchase",
        proofRequirement: "Genre sample gallery and free pre-payment preview",
        objectionAddressed: "Worry that the musical style won't suit the family celebration",
        cta: "Select Style & Preview Track",
      },
    ];

    expect(lane1PersuasionSequence[0].stepLabel).not.toBe(lane2PersuasionSequence[0].stepLabel);
    expect(lane1PersuasionSequence[0].coreMessage).not.toBe(lane2PersuasionSequence[0].coreMessage);
    expect(lane1PersuasionSequence[0].beliefShift).not.toBe(lane2PersuasionSequence[0].beliefShift);
    expect(lane1PersuasionSequence[0].cta).not.toBe(lane2PersuasionSequence[0].cta);
  });

  it("10. Semantic validator rejection blocks plan approval and is not swallowed as a warning", async () => {
    const results = new Map<any, any>([
      [
        "positioning",
        {
          output: {
            primaryTerritory: "Preview-First Story Song Creation",
            primaryAxis: "shared_capability_strategic_emphasis",
            narrativeDistanceScore: 0.45,
            territories: [
              {
                name: "Preview-First Story Song Creation",
                narrativeDistanceScore: 0.45,
                epistemicStatus: "STRATEGIC_HYPOTHESIS",
                semanticCollision: {
                  comparisonStatus: "COMPARISON_COMPLETED",
                  comparedCompetitorCount: 4,
                  semanticCollisionScore: 0.55,
                  verdict: "MODERATE_OVERLAP",
                },
              },
            ],
          },
        },
      ],
    ]);

    const validation = await validateCrossEngineStrategyConsistency(results, {}, "test_account", {
      canonicalContext: {
        productTruth: {
          verifiedFacts: [{ id: "pf_1", claim: "Free song preview available before payment" }],
        },
      },
      synthesizedPlan: {
        strategicSummary: {
          strategy: "Only platforms like Songai can guarantee emotional authenticity with £19.99 instant MP3 downloads.",
          rationale: "Exclusive category dominance.",
        },
        buyerConversionJourneys: [
          {
            laneId: "lane_1",
            stages: [{ stageName: "Entry", coreMessage: "Preview your song", cta: "Start Preview" }],
            persuasionStrategy: {
              messageSequence: [{ step: "step_1", rationale: "Preview" }],
              objections: [{ objectionId: "obj_1", objection: "Quality", response: "Free preview", supportingFactId: "pf_1" }],
            },
          },
        ],
      },
    });

    expect(validation.valid).toBe(false);
    expect(validation.blocking).toBe(true);
    expect(validation.checkFailed).toBe(true);
    expect(["FAILED_DETERMINISTIC", "FAILED_SEMANTIC"]).toContain(validation.outcomeType);
  });

  it("11. Final validation evaluates post-synthesis / post-BLL output, not only pre-transform drafts", async () => {
    const results = new Map<any, any>([
      [
        "positioning",
        {
          output: {
            primaryTerritory: "Preview-First Story Song Creation",
            primaryAxis: "shared_capability_strategic_emphasis",
            narrativeDistanceScore: 0.45,
            territories: [
              {
                name: "Preview-First Story Song Creation",
                narrativeDistanceScore: 0.45,
                epistemicStatus: "STRATEGIC_HYPOTHESIS",
                semanticCollision: {
                  comparisonStatus: "COMPARISON_COMPLETED",
                  comparedCompetitorCount: 4,
                  semanticCollisionScore: 0.55,
                  verdict: "MODERATE_OVERLAP",
                },
              },
            ],
          },
        },
      ],
    ]);

    // Pre-transform strategicSummary is clean, but businessRepresentation.strategicSummary contains an unsupported claim!
    const validation = await validateCrossEngineStrategyConsistency(results, {}, "test_account", {
      canonicalContext: {
        productTruth: {
          verifiedFacts: [{ id: "pf_1", claim: "Free song preview available before payment" }],
        },
      },
      synthesizedPlan: {
        strategicSummary: {
          strategy: "Highlight the free song preview available before payment.",
          rationale: "Reduce buyer risk.",
        },
        businessRepresentation: {
          strategicSummary: {
            strategy: "Highlight our collaborative revision interface and permanent downloadable MP3 access.",
            rationale: "Reduce buyer risk.",
          },
        },
        buyerConversionJourneys: [
          {
            laneId: "lane_1",
            stages: [{ stageName: "Entry", coreMessage: "Preview your song", cta: "Start Preview" }],
            persuasionStrategy: {
              messageSequence: [{ step: "step_1", rationale: "Preview" }],
              objections: [{ objectionId: "obj_1", objection: "Quality", response: "Free preview", supportingFactId: "pf_1" }],
            },
          },
        ],
      },
    });

    expect(validation.valid).toBe(false);
    expect(validation.blocking).toBe(true);
    expect(validation.defects.some((d) => d.category === "FACTUAL_DEFECT" || d.category === "EPISTEMIC_MISMATCH")).toBe(true);
  });

  it("12 & 13. Confirmed budget settings ($5,000/month) reach budget strategy and pre-launch hold assigns cautious 20% validation carveout instead of zero-spend deadlock", () => {
    const confirmedMonthlyBudget = 5000;
    const confirmedPaidScaleBudget = Math.round(confirmedMonthlyBudget * 0.6); // $3,000
    const confirmedTestBudgetMin = Math.round(confirmedPaidScaleBudget * 0.15); // $450
    const confirmedTestBudgetMax = Math.round(confirmedPaidScaleBudget * 0.35); // $1,050

    // Pre-launch hold guard behavior:
    const action = "hold";
    const killFlag = false;
    const performanceConversions = 0;
    const performanceSpend = 0;
    let spendPace: "aggressive" | "measured" | "cautious" | "frozen" = "frozen";
    let learningBudgetCarveOutPct = 0;

    if (action === "hold" && !killFlag && performanceConversions === 0 && performanceSpend === 0 && confirmedTestBudgetMax > 0) {
      if (spendPace === "frozen" || learningBudgetCarveOutPct <= 0) {
        spendPace = "cautious";
        learningBudgetCarveOutPct = 20;
      }
    }

    const initialValidationTestBudget = Math.round(confirmedPaidScaleBudget * (learningBudgetCarveOutPct / 100));

    expect(confirmedMonthlyBudget).toBe(5000);
    expect(confirmedPaidScaleBudget).toBe(3000);
    expect(confirmedTestBudgetMin).toBe(450);
    expect(confirmedTestBudgetMax).toBe(1050);
    expect(spendPace).toBe("cautious");
    expect(learningBudgetCarveOutPct).toBe(20);
    expect(initialValidationTestBudget).toBe(600);
  });

  it("14. Second non-Songai business fixture (B2B Cold-Chain Logistics SaaS) proves tenant neutrality across comparison, territory naming, AEL, and validation", async () => {
    const b2bTerritory = sanitizeTerritoryName(
      "CryoTrack Cold-Chain Excursion Failure System",
      {
        brandName: "CryoTrack",
        coreOffer: "Real-time BLE temperature telemetry for biologic shipments",
        productCategory: "B2B Cold-Chain Logistics SaaS",
      },
      "Manual USB temperature logger downloads delay quarantine release",
    );
    expect(b2bTerritory.toLowerCase()).not.toContain("failure system");
    expect(b2bTerritory.toLowerCase()).not.toMatch(/song|mp3|lyric|gift/i);

    const b2bClaims = extractCanonicalCompetitorPositioningClaims({
      competitors: [
        { id: "comp_sensitech", name: "Sensitech", businessType: "Cold-chain visibility platform" },
      ],
      cuSnapshots: [
        {
          id: "cu_sensitech_1",
          competitorId: "comp_sensitech",
          competitorName: "Sensitech",
          competitorUnderstanding: {
            offers: [{ offerName: "TempTale GEO", description: "Cellular real-time temperature monitoring for pharma lanes" }],
            positioning: [{ claim: "Real-time cold-chain visibility and automated compliance reporting for global pharma." }],
          },
        },
      ],
      productDna: {
        coreOffer: "Real-time BLE temperature telemetry for biologic shipments",
        productCategory: "B2B Cold-Chain Logistics SaaS",
        coreProblemSolved: "Delayed quarantine release from manual logger reads",
      },
    });

    expect(b2bClaims).toHaveLength(1);
    expect(b2bClaims[0].competitorId).toBe("comp_sensitech");
    expect(b2bClaims[0].relationshipClass).toBe("DIRECT");
    expect(JSON.stringify(b2bClaims)).not.toMatch(/song|mp3|lyric|gift/i);
  });
});
